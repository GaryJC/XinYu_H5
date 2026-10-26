import { saveDraftPendingRepairs } from './repositories/pendingRepairsRepository.mjs';
import { userRoles, hasRole, hasAnyRole } from "../shared/roles.mjs";
import { queueCustomerSignatureReview } from "./repositories/customerSignatureReviewRepository.mjs";
import { isRemoteSignatureToken } from "./domain/customerSignaturePolicy.mjs";
import { assertPaperPhotoIds, attachPaperPhotos, enqueuePaperNotifications } from "./repositories/paperOrderRepository.mjs";
import { attachDraftVehicleLicense } from "./repositories/draftVehicleLicenseRepository.mjs";
import { assertNoActiveRepair } from './repositories/repairRoundRepository.mjs';
import {readLicenseExceptions} from './repositories/vehicleLicenseExceptionRepository.mjs';
import {assertWorkOrderAccess} from './repositories/accessRepository.mjs';
import { attachPreRepairPhotos } from "./repositories/preRepairPhotoRepository.mjs";
import { assertPreRepairPhotosReady } from "./domain/preRepairPhotos.mjs";
import { getDispatchTask, assertInspectionCompleted } from './repositories/dispatchRepository.mjs';
import { saveDispatchPlan, readDispatchPlans } from './repositories/dispatchPlanRepository.mjs';
import { activateDispatchPlan } from './services/dispatchPlanService.mjs';
import { pool, transaction } from "./database/pool.mjs";
import { HttpError } from "./http/HttpError.mjs";
import {
  buildTrend,
  countBy,
  createId,
  createOrderFromDraft,
  createSignatureToken,
  groupBy,
  nowString,
  parseDate,
  repairActionText,
  rowToWorkOrder,
  workOrderValues
} from "./domain/workOrderModel.mjs";
import {
  assertDraftEditable,
  assertOrderReadyForSignature,
  assertPlatformSyncAllowed,
  assertRepairItemAction,
  assertSettlementAllowed,
  assertStatusTransition,
  sanitizeTransitionPatch
} from "./domain/workOrderPolicy.mjs";
import { enqueueLegacySyncEvent } from "./repositories/legacySyncOutboxRepository.mjs";

const validRoles = new Set(["advisor", "technician", "inspector", "manager"]);

export async function healthCheck() {
  await pool.query("select 1");
  return { ok: true, database: "postgres" };
}

export async function listWorkOrders(role = "manager", user) {
  const { where, params } = roleFilter(role, user);
  const { rows } = await pool.query(
    `
      select wo.*, st.token as signature_token, st.used as signature_token_used
      from work_orders wo
      left join lateral (
        select token, used
        from signature_tokens
        where order_id = wo.id
        order by created_at desc
        limit 1
      ) st on true
      ${where}
      order by wo.updated_at desc, wo.created_at desc
    `,
    params
  );
  const orders = await hydrateOrders(rows);
  return sanitizeVisibleOrders(orders, role, user);
}

export function sanitizeVisibleOrders(orders, role, user) {
  if (role === "manager") return orders;
  if (role !== "advisor") return orders.map(order => ({ ...order, signatureToken: undefined, signatureTokenUsed: undefined }));
  return orders.map((order) => order.advisor === user?.name
    ? order
    : { ...order, signatureToken: undefined, signatureTokenUsed: undefined });
}

export async function createWorkOrder(draft, actor, actorUser) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    throw new HttpError(400, "缺少有效的委托单草稿");
  }
  if (draft.paperOrder) assertPaperPhotoIds(draft.paperOrder);
  return transaction(async (client) => {
    const order = {
      ...createOrderFromDraft(draft),
      dispatchNo: "",
      ...(draft.paperOrder ? { status: "待处理纸质委托书", vehicle: {}, customer: {}, department: { code: "", name: "" }, faultDescription: "", estimatedFee: 0, settlementAmount: 0, feeNote: "", estimatedDeliveryAt: "", repairItems: [], dispatchPlan: null, signatures: {}, inspection: { belongings: [], fuelLevel: "1/2", exteriorIssues: [] } } : {})
    };
    await upsertWorkOrder(client, order);
    await saveDraftPendingRepairs(client, order, actorUser);
    if (order.paperOrder) {
      await attachPaperPhotos(client, order, actorUser?.id);
      await enqueuePaperNotifications(client, order);
    }
    await attachPreRepairPhotos(client, order, actorUser?.id);
    await attachDraftVehicleLicense(client, order, actorUser?.id);
    await saveDispatchPlan(client, order, actorUser, order.dispatchPlan);
    await addAudit(client, order.id, actor, "创建委托单草稿");
    return findWorkOrderById(client, order.id);
  });
}

export async function updateWorkOrder(order, actor, action, actorUser) {
  return transaction(async (client) => {
    const existing = await findWorkOrderById(client, order.id, true);
    if (!existing) throw new HttpError(404, "委托单不存在");
    assertDraftEditable(existing.status,existing);
    if(existing.status==='待客户签字') {
      const queued=await client.query('select 1 from legacy_sync_outbox where order_id=$1 limit 1',[existing.id]);
      if(queued.rowCount)throw new HttpError(409,'委托单已进入润丰拉取队列，不能修改签字前内容');
    }
    const next = {
      ...existing,
      ...order,
      paperOrder: existing.paperOrder,
      id: existing.id,
      createdAt: existing.createdAt,
      advisor: existing.advisor,
      shop: existing.shop,
      technician: existing.technician,
      inspector: existing.inspector,
      dispatchNo: existing.dispatchNo,
      status: existing.status,
      signatures: existing.signatures,
      platformOrderNo: existing.platformOrderNo,
      repairItems: normalizeDraftRepairItems(order.repairItems),
      updatedAt: nowString()
    };
    await upsertWorkOrder(client, next);
    await saveDraftPendingRepairs(client, next, actorUser, order.pendingRepairsVersion);
    // Editing unsigned content invalidates every old signature session, including remote links.
    await client.query("update signature_tokens set expires_at=clock_timestamp() where order_id=$1 and not used", [next.id]);
    await attachPreRepairPhotos(client, next, actorUser?.id);
    await attachDraftVehicleLicense(client, next, actorUser?.id);
    await saveDispatchPlan(client, next, actorUser, next.dispatchPlan);
    await addAudit(client, next.id, actor, action);
    return findWorkOrderById(client, next.id);
  });
}

export async function deleteDraftWorkOrder(id, runTransaction = transaction) {
  return runTransaction(async (client) => {
    const existing = await client.query(
      "select id, status from work_orders where id = $1 for update",
      [id]
    );
    const order = existing.rows[0];
    if (!order) throw new HttpError(404, "委托单不存在");
    if (order.status !== "草稿") throw new HttpError(409, `当前状态“${order.status}”不能删除，只能删除草稿`);
    const deleted = await client.query("delete from work_orders where id = $1 returning id", [id]);
    return { id: deleted.rows[0].id };
  });
}

export async function transitionWorkOrder(id, status, actor, action, patch = {}) {
  return transaction(async (client) => {
    const order = await findWorkOrderById(client, id, true);
    if (!order) throw new HttpError(404, "委托单不存在");
    if (["维修中", "待结算"].includes(status)) throw new HttpError(409, "请使用派工流程操作");
    assertStatusTransition(order.status, status);
    if(status==="完成") {await assertNoActiveRepair(client,id);await assertInspectionCompleted(client,id);}
    const safePatch = sanitizeTransitionPatch(status, patch);
    const repairItems = status === "维修中"
      ? order.repairItems.map((item) => ({
        ...item,
        owner: item.owner === "待派工" ? safePatch.technician : item.owner
      }))
      : order.repairItems;
    const next = { ...order, ...safePatch, id: order.id, advisor: order.advisor, repairItems, status, updatedAt: nowString() };
    await upsertWorkOrder(client, next);
    await addAudit(client, id, actor, action);
    return findWorkOrderById(client, id);
  });
}

export async function createSignatureTokenForOrder(id, actor, { renew = false, signatureMode } = {}) {
  if (signatureMode !== undefined && !["onsite", "remote"].includes(signatureMode)) throw new HttpError(400, "请选择有效的客户签字方式");
  return transaction(async (client) => {
    let order = await findWorkOrderById(client, id, true);
    if (!order) throw new HttpError(404, "委托单不存在");
    const supplemental = Boolean(order.paperOrder || !["草稿", "待客户签字"].includes(order.status) || order.customerSignatureReview?.supplemental);
    const purpose = supplemental ? "supplement" : "authorization";
    const resign = renew && order.customerSignatureReview?.state === "pending";
    if (order.customerSignatureFileId && !resign) throw new HttpError(409, "客户签名已上传，无需再次发起签字");
    if (!supplemental) {
      assertOrderReadyForSignature(order); assertPreRepairPhotosReady(order);
      // Opening the onsite dialog must not submit an unsigned draft.
      const status = signatureMode === 'remote' ? '待客户签字' : signatureMode === 'onsite' ? '草稿' : order.status;
      if (status !== order.status) {
        await upsertWorkOrder(client, { ...order, status, updatedAt: nowString() });
        await addAudit(client, id, actor, status === '待客户签字' ? '车主不在现场，选择后续发送签字链接' : '改为现场签字，未签字保留草稿');
        order = { ...order, status };
      }
    }
    const { rows: sessions } = await client.query(
      "select token,purpose from signature_tokens where order_id=$1 and not used and (expires_at is null or expires_at>clock_timestamp()) order by created_at desc,token desc limit 1 for update", [id]
    );
    if (!renew && sessions[0]?.purpose === purpose && isRemoteSignatureToken(sessions[0].token)) return { ...order, signaturePurpose: purpose, signatureToken: sessions[0].token, signatureTokenUsed: false };
    await client.query("update signature_tokens set expires_at=clock_timestamp() where order_id=$1", [id]);
    const token = createSignatureToken();
    if (resign) {
      await client.query("update work_orders set customer_signature_review=null where id=$1", [id]);
      await client.query("update dispatch_notifications set status='failed',retryable=false,error='已要求客户重签',next_attempt_at=null where order_id=$1 and kind='需确认用户签字' and status='pending'", [id]);
    }
    if (supplemental) {
      if (resign) await client.query("delete from signatures where order_id=$1 and signer_type='customer'", [id]);
      await client.query("update work_orders set updated_at=now() where id=$1", [id]);
    } else await upsertWorkOrder(client, { ...order, signatures: resign ? { ...order.signatures, customer: undefined } : order.signatures, status: order.status, updatedAt: nowString() });
    await client.query(
      `
        insert into signature_tokens (token, order_id, used, expires_at, purpose)
        values ($1, $2, false, null, $3)
      `,
      [token, id, purpose]
    );
    await addAudit(client, id, actor, renew ? "重新发送客户签字链接，旧链接失效" : supplemental ? "生成补充客户签名链接" : order.status === "草稿" ? "发起客户签字" : "恢复客户签字会话");
    return { ...await findWorkOrderById(client, id), signaturePurpose: purpose, signatureToken: token, signatureTokenUsed: false };
  });
}

export async function findWorkOrderByToken(token) {
  const { rows } = await pool.query(
    `
      select wo.*, st.token as signature_token, st.used as signature_token_used, st.expires_at as signature_expires_at, st.purpose as signature_purpose
      from signature_tokens st
      join work_orders wo on wo.id = st.order_id
      where st.token = $1
        and (st.expires_at is null or st.expires_at > now())
    `,
    [token]
  );
  const order = (await hydrateOrders(rows))[0];
  return order ? { ...order, signaturePurpose: rows[0].signature_purpose, signatureExpiresAt: rows[0].signature_expires_at?.toISOString() } : undefined;
}

export async function signWorkOrderByToken(token, signature, signatureFileId, createSignatureFile, onsiteActor) {
  return transaction(async (client) => {
    // Resolve the parent without a token lock, then use the same parent -> token
    // lock order as session creation. Recheck validity after acquiring the parent.
    const { rows: references } = await client.query("select order_id from signature_tokens where token=$1", [token]);
    if (!references[0]) throw new HttpError(404, "签字链接不存在或已失效");
    const order = await findWorkOrderById(client, references[0].order_id, true);
    if (!order) throw new HttpError(404, "委托单不存在");
    const tokenResult = await client.query(
      `
        select *
        from signature_tokens
        where token = $1
          and (expires_at is null or expires_at > clock_timestamp())
        for update
      `,
      [token]
    );
    const tokenRow = tokenResult.rows[0];
    if (!tokenRow) throw new HttpError(404, "签字链接不存在或已失效");
    if (tokenRow.used) throw new HttpError(409, "签字链接已使用");

    const supplemental = tokenRow.purpose === "supplement";
    if (order.customerSignatureFileId || !supplemental && (!["草稿", "待客户签字"].includes(order.status) || order.paperOrder)) throw new HttpError(409, "当前委托单已签字或不能签字");
    if (!supplemental) {
      if (createSignatureFile && order.status !== '待客户签字') throw new HttpError(409, '尚未选择远程签字，请联系服务顾问');
      assertOrderReadyForSignature(order); assertPreRepairPhotosReady(order);
    }
    // A remote signature is stored only after locking and validating the session.
    // Its file metadata participates in the same transaction as the signature.
    if (createSignatureFile) {
      const file = await createSignatureFile(client, order);
      signatureFileId = file.id;
      signature = order.customer.name || "客户签名";
    }
    if (!signatureFileId) throw new HttpError(400, "请完成手写签名");
    const signatureFile = await client.query(
      "select id from files where id = $1 and order_id = $2 and kind = 'signature_image'",
      [signatureFileId, order.id]
    );
    if (!signatureFile.rows[0]) throw new HttpError(400, "签字图片不存在或未关联当前委托单");

    const next = {
      ...order,
      status: supplemental ? order.status : "待客户签字",
      updatedAt: nowString(),
      signatures: {
        ...order.signatures,
        customer: signature
      }
    };
    if (supplemental) {
      await client.query("insert into signatures(order_id,signer_type,signer_name) values($1,'customer',$2) on conflict(order_id,signer_type) do update set signer_name=excluded.signer_name,signed_at=now()", [order.id, signature]);
      await client.query("update work_orders set updated_at=now() where id=$1", [order.id]);
    } else await upsertWorkOrder(client, next);
    await client.query(
      "update signatures set file_id = $3 where order_id = $1 and signer_type = $2",
      [order.id, "customer", signatureFileId]
    );
    await client.query("update signature_tokens set used = true, used_at = now() where token = $1", [token]);
    await addAudit(client, order.id, order.customer.name || "车主", "客户完成电子签名");
    // Only the authenticated staff endpoint may attest to an onsite signature.
    // Public remote signatures continue through independent staff review.
    const onsite = !createSignatureFile && onsiteActor && (supplemental || order.status === '草稿');
    if (onsite) {
      if (!onsiteActor.active || onsiteActor.shopId !== order.shop.id || !hasAnyRole(onsiteActor, ['advisor','manager'])
        || !hasRole(onsiteActor,'manager') && onsiteActor.name !== order.advisor) throw new HttpError(403,'仅负责此单的服务顾问或本店管理员可以提交现场签字');
      const at=new Date().toISOString();
      const review={state:'confirmed',signedAt:at,confirmedAt:at,confirmedBy:onsiteActor.name,mode:'onsite',...(supplemental?{supplemental:true}:{})};
      await client.query('update work_orders set status=$2,customer_signature_review=$3::jsonb,updated_at=now() where id=$1',[order.id,supplemental?order.status:'已委托',JSON.stringify(review)]);
      await addAudit(client,order.id,onsiteActor.name,supplemental?'现场补充签字已确认':'现场客户签字确认，提交后续流程');
      if (!supplemental) {
        await activateDispatchPlan(client,await findWorkOrderById(client,order.id));
        await enqueueLegacySyncEvent(client,await findWorkOrderById(client,order.id),'created');
      }
    } else await queueCustomerSignatureReview(client, next, { supplemental });
    return findWorkOrderById(client, order.id);
  });
}


export async function confirmCustomerSignature(id, actor) {
  return transaction(async client => {
    const order = await findWorkOrderById(client, id, true);
    if (!order) throw new HttpError(404, "委托单不存在");
    if (!actor?.active || actor.shopId !== order.shop.id || !hasAnyRole(actor, ["advisor", "manager"])
      || !hasRole(actor, 'manager') && hasRole(actor, 'advisor') && actor.name !== order.advisor) throw new HttpError(403, "仅负责此单的服务顾问或本店管理员可以确认签字");
    if (order.customerSignatureReview?.state === "confirmed") return order;
    if ((!order.customerSignatureReview?.supplemental && order.status !== "待客户签字") || order.customerSignatureReview?.state !== "pending"
      || !order.signatures.customer || !order.customerSignatureFileId) throw new HttpError(409, "当前委托单没有待确认的客户签字");
    const review = { ...order.customerSignatureReview, state: "confirmed", confirmedAt: new Date().toISOString(), confirmedBy: actor.name };
    if (review.supplemental) {
      await client.query("update work_orders set customer_signature_review=$2::jsonb,updated_at=now() where id=$1", [id, JSON.stringify(review)]);
      await addAudit(client, id, actor.name, "确认补充客户签名");
      return findWorkOrderById(client, id);
    }
    await client.query("update work_orders set status='已委托', customer_signature_review=$2::jsonb, updated_at=now() where id=$1", [id, JSON.stringify(review)]);
    await addAudit(client, id, actor.name, "确认用户签字，提交后续流程");
    const next = await findWorkOrderById(client, id);
    await activateDispatchPlan(client, next);
    await enqueueLegacySyncEvent(client, await findWorkOrderById(client, id), "created");
    return findWorkOrderById(client, id);
  });
}

export async function syncWorkOrderToPlatform(id, actor) {
  return transaction(async (client) => {
    const order = await findWorkOrderById(client, id, true);
    if (!order) throw new HttpError(404, "委托单不存在");
    assertPlatformSyncAllowed(order);
    const platformOrderNo = order.platformOrderNo || createId("PLAT");
    const dispatchNo = order.dispatchNo;
    const syncId = createId("sync");
    const nextItems = order.repairItems || [];
    await upsertWorkOrder(client, {
      ...order,
      platformOrderNo,
      dispatchNo,
      repairItems: nextItems,
      updatedAt: nowString()
    });
    await client.query(
      `
        insert into platform_sync_records (id, order_id, platform_order_no, status, message)
        values ($1, $2, $3, '已同步', $4)
      `,
      [syncId, id, platformOrderNo, "已生成维修业务平台工单和模拟出库单"]
    );
    await upsertOutboundOrder(client, id, dispatchNo, platformOrderNo, nextItems, order.technician || "待派工");
    await addAudit(client, id, actor, "同步至维修业务平台并生成出库单");
    return findWorkOrderById(client, id);
  });
}

export async function repairItemAction() {
  throw new HttpError(409, "请使用派工模块；维修项目操作必须携带当前员工身份和任务版本");
}

export async function createSettlementForOrder(orderId, actor) {
  return transaction(async (client) => {
    const order = await findWorkOrderById(client, orderId, true);
    if (!order) throw new HttpError(404, "委托单不存在");
    assertSettlementAllowed(order.status);
    await assertNoActiveRepair(client,orderId);
    if (order.settlementStatements.length) return order;
    const amount = Number(order.settlementAmount || order.estimatedFee || order.repairItems.reduce((sum, item) => sum + Number(item.laborFee || 0), 0));
    const id = createId("settle");
    await client.query(
      `
        insert into settlement_statements (id, order_id, dispatch_no, plate, technician, amount, source, match_status)
        values ($1, $2, $3, $4, $5, $6, '维修业务平台', '已匹配')
      `,
      [id, orderId, order.dispatchNo || order.id, order.vehicle.plate || "", order.technician || "待派工", amount]
    );
    await upsertWorkOrder(client, { ...order, settlementAmount: amount, updatedAt: nowString() });
    await addAudit(client, orderId, actor, "同步并匹配结算清单");
    return findWorkOrderById(client, orderId);
  });
}

export async function dashboardSummary(role = "manager", user) {
  const orders = await listWorkOrders(role, user);
  const statusCounts = countBy(orders, (order) => order.status);
  const repairItemCounts = countBy(orders.flatMap((order) => order.repairItems), (item) => item.name || "未命名项目");
  const mileageBuckets = {
    "0-5万": 0,
    "5-10万": 0,
    "10万以上": 0
  };
  for (const order of orders) {
    const mileage = Number(order.vehicle.mileage || 0);
    if (mileage < 50000) mileageBuckets["0-5万"] += 1;
    else if (mileage < 100000) mileageBuckets["5-10万"] += 1;
    else mileageBuckets["10万以上"] += 1;
  }
  return {
    total: orders.length,
    statusCounts,
    trend: buildTrend(orders),
    repairItemCounts,
    mileageBuckets,
    employeeRanking: countBy(orders, (order) => order.technician || "待派工")
  };
}

export async function findWorkOrderById(client, id, forUpdate = false) {
  const { rows } = await client.query(
    `
      select wo.*, st.token as signature_token, st.used as signature_token_used
      from work_orders wo
      left join lateral (
        select token, used
        from signature_tokens
        where order_id = wo.id
        order by created_at desc
        limit 1
      ) st on true
      where wo.id = $1
      ${forUpdate ? "for update of wo" : ""}
    `,
    [id]
  );
  return (await hydrateOrders(rows, client))[0];
}

async function hydrateOrders(rows, client = pool) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const repairItems = await client.query(
    `
      select *
      from repair_items
      where order_id = any($1::text[])
      order by order_id, item_no, id
    `,
    [ids]
  );
  const signatures = await client.query(
    `
      select *
      from signatures
      where order_id = any($1::text[])
      order by order_id, signed_at
    `,
    [ids]
  );
  const auditLogs = await client.query(
    `
      select *
      from audit_logs
      where order_id = any($1::text[])
      order by order_id, at desc, id desc
    `,
    [ids]
  );
  const ocrRecords = await client.query(
    `
      select *
      from ocr_records
      where order_id = any($1::text[])
      order by order_id, created_at desc
    `,
    [ids]
  );
  const syncRecords = await client.query(
    `
      select *
      from platform_sync_records
      where order_id = any($1::text[])
      order by order_id, synced_at desc
    `,
    [ids]
  );
  const outboundOrders = await client.query(
    `
      select oo.*, coalesce(json_agg(json_build_object(
        'id', ooi.id,
        'repair_item_id', ooi.repair_item_id,
        'name', ooi.name,
        'quantity', ooi.quantity,
        'picked', ooi.picked
      ) order by ooi.id) filter (where ooi.id is not null), '[]') as items
      from outbound_orders oo
      left join outbound_order_items ooi on ooi.outbound_order_id = oo.id
      where oo.order_id = any($1::text[])
      group by oo.id
      order by oo.order_id, oo.created_at desc
    `,
    [ids]
  );
  const settlements = await client.query(
    `
      select *
      from settlement_statements
      where order_id = any($1::text[])
      order by order_id, synced_at desc
    `,
    [ids]
  );
  const files = await client.query(
    `
      select *
      from files
      where order_id = any($1::text[])
      order by order_id, created_at desc
    `,
    [ids]
  );

  const licenseExceptions = await readLicenseExceptions(client,ids);
  const dispatchPlans = await readDispatchPlans(client, ids);
  const itemsByOrder = groupBy(repairItems.rows, "order_id");
  const signaturesByOrder = groupBy(signatures.rows, "order_id");
  const auditByOrder = groupBy(auditLogs.rows, "order_id");
  const ocrByOrder = groupBy(ocrRecords.rows, "order_id");
  const syncByOrder = groupBy(syncRecords.rows, "order_id");
  const outboundByOrder = groupBy(outboundOrders.rows, "order_id");
  const settlementByOrder = groupBy(settlements.rows, "order_id");
  const filesByOrder = groupBy(files.rows, "order_id");

  return rows.map((row) => ({
    ...rowToWorkOrder(
      row,
      itemsByOrder.get(row.id) || [],
      signaturesByOrder.get(row.id) || [],
      auditByOrder.get(row.id) || [],
      ocrByOrder.get(row.id) || [],
      syncByOrder.get(row.id) || [],
      outboundByOrder.get(row.id) || [],
      settlementByOrder.get(row.id) || [],
      filesByOrder.get(row.id) || []
    ),
    vehicleLicenseException: licenseExceptions.get(row.id),
    dispatchPlan: dispatchPlans.get(row.id)
  }));
}

export async function upsertWorkOrder(client, order) {
  await client.query(
    `
      insert into work_orders (
        id, status, advisor, department_code, department_name, technician, inspector,
        dispatch_no, arrival_date, shop_id, shop_name, shop_address, shop_phone,
        vehicle_plate, vehicle_vin, vehicle_mileage, vehicle_model, vehicle_model_legacy_code, vehicle_purchase_date,
        customer_name, customer_legacy_code, customer_phone, customer_contact, customer_address,
        inspection, fault_description, estimated_fee, old_parts_handling,
        estimated_delivery_at, settlement_amount, fee_note, platform_order_no,
        created_at, updated_at, paper_order, vehicle_is_military
      ) values (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24,
        $25::jsonb, $26, $27, $28,
        $29, $30, $31, $32,
        $33, $34, $35::jsonb, $36
      )
      on conflict (id) do update set
        status = excluded.status,
        advisor = excluded.advisor,
        department_code = excluded.department_code,
        department_name = excluded.department_name,
        technician = excluded.technician,
        inspector = excluded.inspector,
        dispatch_no = excluded.dispatch_no,
        arrival_date = excluded.arrival_date,
        shop_id = excluded.shop_id,
        shop_name = excluded.shop_name,
        shop_address = excluded.shop_address,
        shop_phone = excluded.shop_phone,
        vehicle_is_military = excluded.vehicle_is_military,
        paper_order = excluded.paper_order,
        vehicle_plate = excluded.vehicle_plate,
        vehicle_vin = excluded.vehicle_vin,
        vehicle_mileage = excluded.vehicle_mileage,
        vehicle_model = excluded.vehicle_model,
        vehicle_model_legacy_code = excluded.vehicle_model_legacy_code,
        vehicle_purchase_date = excluded.vehicle_purchase_date,
        customer_name = excluded.customer_name,
        customer_legacy_code = excluded.customer_legacy_code,
        customer_phone = excluded.customer_phone,
        customer_contact = excluded.customer_contact,
        customer_address = excluded.customer_address,
        inspection = excluded.inspection,
        fault_description = excluded.fault_description,
        estimated_fee = excluded.estimated_fee,
        old_parts_handling = excluded.old_parts_handling,
        estimated_delivery_at = excluded.estimated_delivery_at,
        settlement_amount = excluded.settlement_amount,
        fee_note = excluded.fee_note,
        platform_order_no = excluded.platform_order_no,
        updated_at = excluded.updated_at
    `,
    workOrderValues(order)
  );

  await replaceRepairItems(client, order.id, order.repairItems || []);
  await replaceSignatures(client, order.id, order.signatures || {});
}

async function replaceRepairItems(client, orderId, items) {
  const itemIds = items.map((item, index) => Number(item.id || index + 1));
  if (new Set(itemIds).size !== itemIds.length) throw new HttpError(400, "维修项目编号不能重复");
  await client.query("delete from repair_items where order_id = $1 and not (client_item_id = any($2::bigint[]))",
    [orderId, itemIds]);
  for (const [index, item] of items.entries()) {
    await client.query(
      `
        insert into repair_items (order_id, client_item_id, item_no, name, labor_fee, owner, start_at, finish_at, inspector, status)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        on conflict (order_id, client_item_id) do update set
          item_no=excluded.item_no, name=excluded.name, labor_fee=excluded.labor_fee,
          owner=excluded.owner, start_at=excluded.start_at, finish_at=excluded.finish_at,
          inspector=excluded.inspector, status=excluded.status
      `,
      [
        orderId,
        Number(item.id || index + 1),
        index + 1,
        item.name || "",
        Number(item.laborFee || 0),
        item.owner || "待派工",
        item.startAt || "",
        item.finishAt || "",
        item.inspector || "待检验",
        item.status || "待派工"
      ]
    );
  }
}

function normalizeDraftRepairItems(items) {
  if (!Array.isArray(items)) throw new HttpError(400, "维修项目参数必须是数组");
  return items.map((item, index) => ({
    ...item,
    id: Number(item?.id || index + 1),
    owner: "待派工",
    startAt: "",
    finishAt: "",
    inspector: "待检验",
    status: "待派工"
  }));
}

async function replaceSignatures(client, orderId, signatures) {
  const entries = Object.entries(signatures).filter(([, signerName]) => Boolean(signerName));
  const signerTypes = entries.map(([signerType]) => signerType);
  if (signerTypes.length) {
    await client.query(
      "delete from signatures where order_id = $1 and not (signer_type = any($2::text[]))",
      [orderId, signerTypes]
    );
  } else {
    await client.query("delete from signatures where order_id = $1", [orderId]);
  }
  for (const [signerType, signerName] of entries) {
    await client.query(
      `
        insert into signatures (order_id, signer_type, signer_name)
        values ($1, $2, $3)
        on conflict (order_id, signer_type) do update set
          signer_name = excluded.signer_name,
          signed_at = now()
      `,
      [orderId, signerType, signerName]
    );
  }
}

async function addAudit(client, orderId, actor, action) {
  await client.query("insert into audit_logs (order_id, actor, action) values ($1, $2, $3)", [orderId, actor || "系统", action || "更新委托单"]);
}

export function roleFilter(role, user) {
  const memberships = userRoles(user);
  if (memberships.length > 1) {
    const filters = memberships.map(member => roleFilter(member, {...user, role: member, roles: [member], outsourcingRoleMember: false}));
    return {where: 'where (' + filters.map(filter => '(' + filter.where.replace(/^where /, '') + ')').join(' or ') + ')',
      params: filters.reduce((longest, filter) => filter.params.length > longest.length ? filter.params : longest, [])};
  }
  if (!validRoles.has(role) || !user?.shopId) return { where: "where false", params: [] };
  const base = "where wo.shop_id = $1";
  if (["technician","outsourcing"].includes(role)) return { where: `${base} and exists (select 1 from dispatch_tasks dt where dt.order_id=wo.id and (dt.technician_id=$2 or dt.data->'technicianIds' ? $2))`, params: [user.shopId,user.id] };
  if (role === "inspector") return { where: `${base} and exists (select 1 from dispatch_tasks dt where dt.order_id=wo.id and dt.inspector_id=$2)`, params: [user.shopId,user.id] };
  if (user.id && ["advisor", "manager"].includes(role)) return {
    where: `where (wo.shop_id = $1 or (wo.paper_order is not null and exists (
      select 1 from dispatch_notifications n where n.order_id=wo.id and n.recipient_id=$2 and n.kind='纸质委托书已创建'
    )))`, params: [user.shopId, user.id]
  };
  return { where: base, params: [user.shopId] };
}

async function upsertOutboundOrder(client, orderId, dispatchNo, platformOrderNo, repairItems, technician) {
  const existing = await client.query("select id from outbound_orders where order_id = $1 order by created_at desc limit 1", [orderId]);
  const outboundId = existing.rows[0]?.id || createId("out");
  await client.query(
    `
      insert into outbound_orders (id, order_id, dispatch_no, platform_order_no, technician, status)
      values ($1, $2, $3, $4, $5, '待领料')
      on conflict (id) do update set
        dispatch_no = excluded.dispatch_no,
        platform_order_no = excluded.platform_order_no,
        technician = excluded.technician,
        status = excluded.status
    `,
    [outboundId, orderId, dispatchNo, platformOrderNo, technician || "待派工"]
  );
  await client.query("delete from outbound_order_items where outbound_order_id = $1", [outboundId]);
  for (const item of repairItems) {
    await client.query(
      `
        insert into outbound_order_items (id, outbound_order_id, repair_item_id, name, quantity, picked)
        values ($1, $2, $3, $4, 1, false)
      `,
      [createId("outi"), outboundId, Number(item.id), item.name || "未命名维修项目"]
    );
  }
}

async function refreshOutboundPickedState(client, orderId, repairItems) {
  const outbound = await client.query("select id from outbound_orders where order_id = $1 order by created_at desc limit 1", [orderId]);
  const outboundId = outbound.rows[0]?.id;
  if (!outboundId) return;
  const pickedIds = repairItems.filter((item) => item.status !== "待领料").map((item) => Number(item.id));
  await client.query("update outbound_order_items set picked = repair_item_id = any($2::bigint[]) where outbound_order_id = $1", [outboundId, pickedIds]);
  const { rows } = await client.query("select count(*)::int as total, count(*) filter (where picked)::int as picked from outbound_order_items where outbound_order_id = $1", [outboundId]);
  const stats = rows[0] || { total: 0, picked: 0 };
  const status = stats.picked === 0 ? "待领料" : stats.picked === stats.total ? "已领料" : "部分领料";
  await client.query("update outbound_orders set status = $2 where id = $1", [outboundId, status]);
}

export async function getWorkOrderDetail(id,user) {
  if(hasRole(user, 'warehouse')) await getDispatchTask(pool,id,user);
  else await assertWorkOrderAccess(id,user);
  const order=await findWorkOrderById(pool,id);
  if(!order)throw new HttpError(404,'委托单不存在');
  return sanitizeVisibleOrders([order],user.role,user)[0];
}
