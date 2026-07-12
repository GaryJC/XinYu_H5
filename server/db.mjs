import { pool, transaction } from "./database/pool.mjs";
import { HttpError } from "./http/HttpError.mjs";
import {
  buildTrend,
  countBy,
  createId,
  createOrderFromDraft,
  createSignatureToken,
  formatDate,
  groupBy,
  nowString,
  parseDate,
  repairActionText,
  rowToOcrRecord,
  rowToWorkOrder,
  workOrderValues
} from "./domain/workOrderModel.mjs";

const validRoles = new Set(["advisor", "dispatcher", "technician", "inspector", "manager"]);

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
  return hydrateOrders(rows);
}

export async function createWorkOrder(draft, actor) {
  return transaction(async (client) => {
    const order = createOrderFromDraft(draft);
    await upsertWorkOrder(client, order);
    await addAudit(client, order.id, actor, "创建委托单草稿");
    return findWorkOrderById(client, order.id);
  });
}

export async function updateWorkOrder(order, actor, action) {
  return transaction(async (client) => {
    const existing = await findWorkOrderById(client, order.id);
    if (!existing) throw new HttpError(404, "委托单不存在");
    const next = { ...existing, ...order, updatedAt: nowString() };
    await upsertWorkOrder(client, next);
    await addAudit(client, next.id, actor, action);
    return findWorkOrderById(client, next.id);
  });
}

export async function transitionWorkOrder(id, status, actor, action, patch = {}) {
  return transaction(async (client) => {
    const order = await findWorkOrderById(client, id);
    if (!order) throw new HttpError(404, "委托单不存在");
    const next = { ...order, ...patch, status, updatedAt: nowString() };
    await upsertWorkOrder(client, next);
    await addAudit(client, id, actor, action);
    return findWorkOrderById(client, id);
  });
}

export async function createSignatureTokenForOrder(id, actor) {
  return transaction(async (client) => {
    const order = await findWorkOrderById(client, id);
    if (!order) throw new HttpError(404, "委托单不存在");
    if (order.status !== "草稿") throw new HttpError(409, `当前状态“${order.status}”不能发起签字`);
    validateOrderForSignature(order);
    const confirmedLicense = await client.query(
      `
        select ocr.id
        from ocr_records ocr
        join files f on f.id = ocr.file_id
        where ocr.order_id = $1
          and ocr.field = 'vehicleLicense'
          and ocr.status = '已确认'
          and f.kind = 'vehicle_license'
        order by ocr.confirmed_at desc
        limit 1
      `,
      [id]
    );
    if (!confirmedLicense.rows[0]) throw new HttpError(400, "请上传并确认行驶证照片后再发起签字");
    const token = createSignatureToken(id);
    await upsertWorkOrder(client, { ...order, status: "待客户签字", updatedAt: nowString() });
    await client.query(
      `
        insert into signature_tokens (token, order_id, used, expires_at)
        values ($1, $2, false, now() + interval '7 days')
      `,
      [token, id]
    );
    await addAudit(client, id, actor, "生成客户签字链接");
    return findWorkOrderById(client, id);
  });
}

export async function findWorkOrderByToken(token) {
  const { rows } = await pool.query(
    `
      select wo.*, st.token as signature_token, st.used as signature_token_used
      from signature_tokens st
      join work_orders wo on wo.id = st.order_id
      where st.token = $1
        and (st.expires_at is null or st.expires_at > now())
    `,
    [token]
  );
  return (await hydrateOrders(rows))[0];
}

export async function signWorkOrderByToken(token, signature, signatureFileId) {
  return transaction(async (client) => {
    const tokenResult = await client.query(
      `
        select *
        from signature_tokens
        where token = $1
          and (expires_at is null or expires_at > now())
        for update
      `,
      [token]
    );
    const tokenRow = tokenResult.rows[0];
    if (!tokenRow) throw new HttpError(404, "签字链接不存在或已失效");
    if (tokenRow.used) throw new HttpError(409, "签字链接已使用");

    const order = await findWorkOrderById(client, tokenRow.order_id);
    if (!order) throw new HttpError(404, "委托单不存在");
    if (!signatureFileId) throw new HttpError(400, "请完成手写签名");
    const signatureFile = await client.query(
      "select id from files where id = $1 and order_id = $2 and kind = 'signature_image'",
      [signatureFileId, order.id]
    );
    if (!signatureFile.rows[0]) throw new HttpError(400, "签字图片不存在或未关联当前委托单");

    const next = {
      ...order,
      status: "已委托",
      updatedAt: nowString(),
      signatures: {
        ...order.signatures,
        customer: signature
      }
    };
    await upsertWorkOrder(client, next);
    await client.query("update signature_tokens set used = true, used_at = now() where token = $1", [token]);
    await addAudit(client, order.id, order.customer.name || "车主", "客户完成电子签名");
    return findWorkOrderById(client, order.id);
  });
}

export async function createOcrRecord({ orderId, field, source, fileId, value, confidence, error }) {
  const id = createId("ocr");
  const status = error ? "识别失败" : "待确认";
  await pool.query(
    `
      insert into ocr_records (id, order_id, field, source, file_id, status, value, confidence, error)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [id, orderId || null, field, source, fileId || createId("file"), status, value || "", Number(confidence || 0), error || null]
  );
  if (orderId) await addAudit(pool, orderId, "OCR", `${source}识别${error ? "失败" : "待确认"}`);
  return findOcrRecord(id);
}

export async function confirmOcrRecord(id, value, actor) {
  const record = await findOcrRecord(id);
  if (!record) throw new HttpError(404, "OCR 记录不存在");
  await transaction(async (client) => {
    await client.query(
      "update ocr_records set status = '已确认', value = $2, confirmed_at = now() where id = $1",
      [id, value || record.value]
    );
    if (record.orderId) await addAudit(client, record.orderId, actor || "服务顾问", `确认OCR字段：${record.field}`);
  });
  return findOcrRecord(id);
}

export async function syncWorkOrderToPlatform(id, actor) {
  return transaction(async (client) => {
    const order = await findWorkOrderById(client, id);
    if (!order) throw new HttpError(404, "委托单不存在");
    if (["草稿", "待客户签字"].includes(order.status)) throw new HttpError(409, "客户完成签字后才能同步维修平台");
    const platformOrderNo = order.platformOrderNo || createId("PLAT");
    const dispatchNo = order.dispatchNo || createId("PG");
    const syncId = createId("sync");
    const nextItems = (order.repairItems || []).map((item) => ({
      ...item,
      status: item.status === "待派工" ? "待领料" : item.status
    }));
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

function validateOrderForSignature(order) {
  const missing = [];
  if (!order.vehicle?.plate?.trim()) missing.push("车牌号码");
  if (!/^[A-Z0-9]{17}$/i.test(order.vehicle?.vin?.trim() || "")) missing.push("17 位 VIN");
  if (!/^\d+(\.\d+)?$/.test(order.vehicle?.mileage?.trim() || "")) missing.push("进厂里程");
  if (!order.customer?.name?.trim()) missing.push("车主名称");
  if (!order.customer?.phone?.trim()) missing.push("联系电话");
  if (!order.faultDescription?.trim()) missing.push("故障描述");
  if (!order.repairItems?.length || order.repairItems.some((item) => !item.name?.trim())) missing.push("维修项目");
  if (missing.length) throw new HttpError(400, `请完善必填项：${missing.join("、")}`);
}

export async function repairItemAction(orderId, itemId, action, actor, patch = {}) {
  return transaction(async (client) => {
    const order = await findWorkOrderById(client, orderId);
    if (!order) throw new HttpError(404, "委托单不存在");
    const now = nowString();
    const nextItems = order.repairItems.map((item) => {
      if (Number(item.id) !== Number(itemId)) return item;
      if (action === "assign") return { ...item, owner: patch.technician || item.owner, status: "待领料" };
      if (action === "pick") return { ...item, status: "待开工" };
      if (action === "start") return { ...item, status: "维修中", startAt: item.startAt || now };
      if (action === "finish") return { ...item, status: "待检验", finishAt: item.finishAt || now };
      if (action === "inspect") return { ...item, status: "已完工", inspector: patch.inspector || actor || item.inspector };
      return { ...item, ...patch };
    });
    const allFinished = nextItems.length > 0 && nextItems.every((item) => item.status === "已完工");
    const nextStatus = allFinished ? "待结算" : order.status === "待派工" ? "维修中" : order.status;
    await upsertWorkOrder(client, { ...order, repairItems: nextItems, status: nextStatus, updatedAt: now });
    await refreshOutboundPickedState(client, orderId, nextItems);
    await addAudit(client, orderId, actor, repairActionText(action));
    return findWorkOrderById(client, orderId);
  });
}

export async function createSettlementForOrder(orderId, actor) {
  return transaction(async (client) => {
    const order = await findWorkOrderById(client, orderId);
    if (!order) throw new HttpError(404, "委托单不存在");
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

export async function createFileRecord({ orderId, kind, storageProvider, bucket, objectKey, originalName, mimeType, sizeBytes, uploadedBy }) {
  const id = createId("file");
  await pool.query(
    `
      insert into files (
        id, order_id, kind, storage_provider, bucket, object_key,
        original_name, mime_type, size_bytes, uploaded_by
      ) values (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10
      )
    `,
    [
      id,
      orderId || null,
      kind,
      storageProvider || "oss",
      bucket,
      objectKey,
      originalName || "",
      mimeType || "",
      Number(sizeBytes || 0),
      uploadedBy || null
    ]
  );
  return {
    id,
    orderId: orderId || undefined,
    kind,
    storageProvider: storageProvider || "oss",
    bucket,
    objectKey,
    originalName: originalName || "",
    mimeType: mimeType || "",
    sizeBytes: Number(sizeBytes || 0),
    uploadedBy: uploadedBy || undefined,
    createdAt: nowString()
  };
}

export async function attachFileToOrder(fileId, orderId) {
  const { rows } = await pool.query(
    `
      update files
      set order_id = $2
      where id = $1
        and (order_id is null or order_id = $2)
      returning *
    `,
    [fileId, orderId]
  );
  const row = rows[0];
  if (!row) throw new HttpError(404, "文件不存在或已关联其他委托单");
  await pool.query(
    "update ocr_records set order_id = $2 where file_id = $1 and (order_id is null or order_id = $2)",
    [fileId, orderId]
  );
  return {
    id: row.id,
    orderId: row.order_id,
    kind: row.kind,
    storageProvider: row.storage_provider,
    bucket: row.bucket,
    objectKey: row.object_key,
    originalName: row.original_name || "",
    mimeType: row.mime_type || "",
    sizeBytes: Number(row.size_bytes || 0),
    uploadedBy: row.uploaded_by || undefined,
    createdAt: formatDate(row.created_at)
  };
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

async function findWorkOrderById(client, id) {
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

  const itemsByOrder = groupBy(repairItems.rows, "order_id");
  const signaturesByOrder = groupBy(signatures.rows, "order_id");
  const auditByOrder = groupBy(auditLogs.rows, "order_id");
  const ocrByOrder = groupBy(ocrRecords.rows, "order_id");
  const syncByOrder = groupBy(syncRecords.rows, "order_id");
  const outboundByOrder = groupBy(outboundOrders.rows, "order_id");
  const settlementByOrder = groupBy(settlements.rows, "order_id");

  return rows.map((row) =>
    rowToWorkOrder(
      row,
      itemsByOrder.get(row.id) || [],
      signaturesByOrder.get(row.id) || [],
      auditByOrder.get(row.id) || [],
      ocrByOrder.get(row.id) || [],
      syncByOrder.get(row.id) || [],
      outboundByOrder.get(row.id) || [],
      settlementByOrder.get(row.id) || []
    )
  );
}

async function upsertWorkOrder(client, order) {
  await client.query(
    `
      insert into work_orders (
        id, status, advisor, technician, inspector,
        dispatch_no, arrival_date, shop_id, shop_name, shop_address, shop_phone,
        vehicle_plate, vehicle_vin, vehicle_mileage, vehicle_model, vehicle_purchase_date,
        customer_name, customer_phone, customer_contact, customer_address,
        inspection, fault_description, estimated_fee, old_parts_handling,
        estimated_delivery_at, settlement_amount, fee_note, platform_order_no,
        created_at, updated_at
      ) values (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16,
        $17, $18, $19, $20,
        $21::jsonb, $22, $23, $24,
        $25, $26, $27, $28,
        $29, $30
      )
      on conflict (id) do update set
        status = excluded.status,
        advisor = excluded.advisor,
        technician = excluded.technician,
        inspector = excluded.inspector,
        dispatch_no = excluded.dispatch_no,
        arrival_date = excluded.arrival_date,
        shop_id = excluded.shop_id,
        shop_name = excluded.shop_name,
        shop_address = excluded.shop_address,
        shop_phone = excluded.shop_phone,
        vehicle_plate = excluded.vehicle_plate,
        vehicle_vin = excluded.vehicle_vin,
        vehicle_mileage = excluded.vehicle_mileage,
        vehicle_model = excluded.vehicle_model,
        vehicle_purchase_date = excluded.vehicle_purchase_date,
        customer_name = excluded.customer_name,
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
  await client.query("delete from repair_items where order_id = $1", [orderId]);
  for (const [index, item] of items.entries()) {
    await client.query(
      `
        insert into repair_items (order_id, client_item_id, item_no, name, labor_fee, owner, start_at, finish_at, inspector, status)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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

async function replaceSignatures(client, orderId, signatures) {
  await client.query("delete from signatures where order_id = $1", [orderId]);
  for (const [signerType, signerName] of Object.entries(signatures)) {
    if (!signerName) continue;
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

function roleFilter(role, user) {
  if (!validRoles.has(role)) return { where: "", params: [] };
  if (role === "technician") return { where: "where wo.technician = $1", params: [user?.name || "陈立"] };
  if (role === "dispatcher") return { where: "where wo.status = any($1::text[])", params: [["待派工", "维修中"]] };
  if (role === "advisor") return { where: "where wo.advisor = $1", params: [user?.name || "林佳"] };
  if (role === "inspector") return { where: "where wo.status = any($1::text[])", params: [["维修中", "待结算"]] };
  return { where: "", params: [] };
}

async function findOcrRecord(id) {
  const { rows } = await pool.query("select * from ocr_records where id = $1", [id]);
  return rows[0] ? rowToOcrRecord(rows[0]) : undefined;
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
