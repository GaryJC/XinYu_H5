import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const pool = new Pool({ connectionString: DATABASE_URL });

const validRoles = new Set(["advisor", "dispatcher", "technician", "inspector", "manager"]);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function healthCheck() {
  await pool.query("select 1");
  return { ok: true, database: "postgres" };
}

export async function listWorkOrders(role = "manager") {
  const { where, params } = roleFilter(role);
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

export async function signWorkOrderByToken(token, signature) {
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
  const [repairItems, signatures, auditLogs] = await Promise.all([
    client.query(
      `
        select *
        from repair_items
        where order_id = any($1::text[])
        order by order_id, item_no, id
      `,
      [ids]
    ),
    client.query(
      `
        select *
        from signatures
        where order_id = any($1::text[])
        order by order_id, signed_at
      `,
      [ids]
    ),
    client.query(
      `
        select *
        from audit_logs
        where order_id = any($1::text[])
        order by order_id, at desc, id desc
      `,
      [ids]
    )
  ]);

  const itemsByOrder = groupBy(repairItems.rows, "order_id");
  const signaturesByOrder = groupBy(signatures.rows, "order_id");
  const auditByOrder = groupBy(auditLogs.rows, "order_id");

  return rows.map((row) => rowToWorkOrder(row, itemsByOrder.get(row.id) || [], signaturesByOrder.get(row.id) || [], auditByOrder.get(row.id) || []));
}

async function upsertWorkOrder(client, order) {
  await client.query(
    `
      insert into work_orders (
        id, status, advisor, technician, inspector,
        vehicle_plate, vehicle_vin, vehicle_mileage, vehicle_model, vehicle_purchase_date,
        customer_name, customer_phone, customer_contact, customer_address,
        inspection, fault_description, estimated_fee, old_parts_handling,
        estimated_delivery_at, settlement_amount, fee_note, platform_order_no,
        created_at, updated_at
      ) values (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15::jsonb, $16, $17, $18,
        $19, $20, $21, $22,
        $23, $24
      )
      on conflict (id) do update set
        status = excluded.status,
        advisor = excluded.advisor,
        technician = excluded.technician,
        inspector = excluded.inspector,
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
        insert into repair_items (order_id, client_item_id, item_no, name, labor_fee, owner)
        values ($1, $2, $3, $4, $5, $6)
      `,
      [orderId, Number(item.id || index + 1), index + 1, item.name || "", Number(item.laborFee || 0), item.owner || "待派工"]
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

async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function roleFilter(role) {
  if (!validRoles.has(role)) return { where: "", params: [] };
  if (role === "technician") return { where: "where wo.technician = $1", params: ["陈立"] };
  if (role === "dispatcher") return { where: "where wo.status = any($1::text[])", params: [["待派工", "维修中"]] };
  if (role === "advisor") return { where: "where wo.advisor = $1", params: ["林佳"] };
  if (role === "inspector") return { where: "where wo.status = any($1::text[])", params: [["维修中", "待结算"]] };
  return { where: "", params: [] };
}

function workOrderValues(order) {
  const inspection = order.inspection || { belongings: [], fuelLevel: "1/2", exteriorIssues: [] };
  return [
    order.id,
    order.status,
    order.advisor || "林佳",
    order.technician || "待派工",
    order.inspector || "待检验",
    order.vehicle?.plate || "",
    order.vehicle?.vin || "",
    order.vehicle?.mileage || "",
    order.vehicle?.model || "",
    order.vehicle?.purchaseDate || "",
    order.customer?.name || "",
    order.customer?.phone || "",
    order.customer?.contact || "",
    order.customer?.address || "",
    JSON.stringify(inspection),
    order.faultDescription || "",
    Number(order.estimatedFee || 0),
    order.oldPartsHandling || "环保处理",
    order.estimatedDeliveryAt || "",
    Number(order.settlementAmount || 0),
    order.feeNote || "",
    order.platformOrderNo || null,
    parseDate(order.createdAt),
    parseDate(order.updatedAt)
  ];
}

function rowToWorkOrder(row, repairItems, signatures, auditLog) {
  return {
    id: row.id,
    status: row.status,
    createdAt: formatDate(row.created_at),
    updatedAt: formatDate(row.updated_at),
    advisor: row.advisor,
    technician: row.technician,
    inspector: row.inspector,
    vehicle: {
      plate: row.vehicle_plate,
      vin: row.vehicle_vin,
      mileage: row.vehicle_mileage,
      model: row.vehicle_model,
      purchaseDate: row.vehicle_purchase_date
    },
    customer: {
      name: row.customer_name,
      phone: row.customer_phone,
      contact: row.customer_contact,
      address: row.customer_address
    },
    inspection: normalizeInspection(row.inspection),
    faultDescription: row.fault_description,
    repairItems: repairItems.map((item) => ({
      id: Number(item.client_item_id),
      name: item.name,
      laborFee: Number(item.labor_fee || 0),
      owner: item.owner
    })),
    estimatedFee: Number(row.estimated_fee || 0),
    oldPartsHandling: row.old_parts_handling,
    estimatedDeliveryAt: row.estimated_delivery_at,
    settlementAmount: Number(row.settlement_amount || 0),
    feeNote: row.fee_note,
    signatures: signatures.reduce((acc, item) => ({ ...acc, [item.signer_type]: item.signer_name }), {}),
    signatureToken: row.signature_token || undefined,
    signatureTokenUsed: row.signature_token_used ?? undefined,
    platformOrderNo: row.platform_order_no || undefined,
    auditLog: auditLog.map((item) => ({
      at: formatDate(item.at),
      actor: item.actor,
      action: item.action
    }))
  };
}

function normalizeInspection(value) {
  const inspection = value || {};
  return {
    belongings: Array.isArray(inspection.belongings) ? inspection.belongings : [],
    fuelLevel: inspection.fuelLevel || "1/2",
    exteriorIssues: Array.isArray(inspection.exteriorIssues) ? inspection.exteriorIssues : []
  };
}

function createOrderFromDraft(draft) {
  const at = nowString();
  return {
    ...draft,
    id: createOrderId(),
    createdAt: at,
    updatedAt: at,
    auditLog: []
  };
}

function createOrderId() {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `WT-${stamp}-${Math.floor(100 + Math.random() * 900)}`;
}

function createSignatureToken(orderId) {
  return `sig_${orderId}_${Math.random().toString(36).slice(2, 9)}`;
}

function groupBy(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const value = row[key];
    result.set(value, [...(result.get(value) || []), row]);
  }
  return result;
}

function parseDate(value) {
  if (!value) return new Date();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? new Date() : new Date(parsed);
}

function nowString() {
  return formatDate(new Date());
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
