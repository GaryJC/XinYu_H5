import { isOrderAdvisor } from "../../shared/orderOwnership.mjs";
import { hasRole, userRoles } from "../../shared/roles.mjs";
import { pool } from "../database/pool.mjs";
import { HttpError } from "../http/HttpError.mjs";

// The archive list and its detail endpoint must apply identical read permissions.
// Mutations keep their separate same-shop owner/manager check below.
function archiveVisibility(role, user) {
  const roles = userRoles({ ...user, role: user?.role ?? role });
  if (!user?.shopId || user.active === false || !roles.length) return { predicate: "false", params: [] };

  const shop = "wo.shop_id = $1";
  if (roles.includes("advisor") || roles.includes("manager")) {
    if (!user.id) return { predicate: shop, params: [user.shopId] };
    return {
      predicate: `(${shop} or (wo.paper_order is not null and exists (
        select 1 from dispatch_notifications n where n.order_id=wo.id and n.recipient_id=$2 and n.kind='纸质委托书已创建'
      )))`,
      params: [user.shopId, user.id]
    };
  }

  const assignments = ["(nullif($2::text,'') is not null and (wo.advisor_user_id=$2 or (wo.advisor_user_id is null and nullif($3::text,'') is not null and wo.advisor=$3)))"];
  if (roles.includes("technician")) assignments.push("exists (select 1 from dispatch_tasks dt where dt.order_id=wo.id and (dt.technician_id=$2 or dt.data->'technicianIds' ? $2))");
  if (roles.includes("inspector")) assignments.push("exists (select 1 from dispatch_tasks dt where dt.order_id=wo.id and dt.inspector_id=$2)");
  return { predicate: `${shop} and (${assignments.join(" or ")})`, params: [user.shopId, user.id, user.name] };
}

export function roleFilter(role, user) {
  const { predicate, params } = archiveVisibility(role, user);
  return { where: `where ${predicate}`, params };
}

export async function assertWorkOrderReadAccess(orderId, user, database = pool) {
  const { predicate, params } = archiveVisibility(user.role, user);
  const { rows: [order] } = await database.query(
    `select wo.shop_id, (${predicate}) as visible from work_orders wo where wo.id=$${params.length + 1}`,
    [...params, orderId]
  );
  if (!order) throw new HttpError(404, "委托单不存在");
  if (!order.visible) throw new HttpError(403, order.shop_id === user.shopId ? "无权访问该委托单" : "无权访问其他门店委托单");
}

export async function assertWorkOrderAccess(orderId, user, database = pool) {
  const { rows } = await database.query("select advisor, advisor_user_id, shop_id from work_orders where id = $1", [orderId]);
  const order = rows[0];
  if (!order) throw new HttpError(404, "委托单不存在");
  assertOrderWriteOwner(order, user);
}

export function assertOrderWriteOwner(order, user) {
  if (!user.shopId || order.shop_id !== user.shopId) throw new HttpError(403, "无权访问其他门店委托单");
  if (hasRole(user, 'manager')) return;
  if (isOrderAdvisor(order.advisor_user_id, order.advisor, user)) return;
  throw new HttpError(403, "无权访问该委托单");
}

export async function assertOcrRecordAccess(recordId, user, database = pool) {
  const { rows } = await database.query(
    `
      select ocr.order_id, f.uploaded_by, wo.advisor, wo.advisor_user_id, coalesce(wo.shop_id, u.shop_id) as shop_id
      from ocr_records ocr
      left join files f on f.id = ocr.file_id
      left join work_orders wo on wo.id = ocr.order_id
      left join users u on u.id = f.uploaded_by
      where ocr.id = $1
    `,
    [recordId]
  );
  const record = rows[0];
  if (!record) throw new HttpError(404, "OCR 记录不存在");
  if (!user.shopId || record.shop_id !== user.shopId) throw new HttpError(403, "无权访问其他门店记录");
  if (hasRole(user, 'manager')) return;
  if ((user.id && record.uploaded_by === user.id || isOrderAdvisor(record.advisor_user_id, record.advisor, user))) return;
  throw new HttpError(403, "无权访问该 OCR 记录");
}
