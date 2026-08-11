import { pool } from "../database/pool.mjs";
import { HttpError } from "../http/HttpError.mjs";

export async function assertWorkOrderAccess(orderId, user, database = pool) {
  const { rows } = await database.query("select advisor from work_orders where id = $1", [orderId]);
  const order = rows[0];
  if (!order) throw new HttpError(404, "委托单不存在");
  if (user.role === "manager") return;
  if (user.role === "advisor" && order.advisor === user.name) return;
  throw new HttpError(403, "无权访问该委托单");
}

export async function assertOcrRecordAccess(recordId, user, database = pool) {
  const { rows } = await database.query(
    `
      select ocr.order_id, f.uploaded_by, wo.advisor
      from ocr_records ocr
      left join files f on f.id = ocr.file_id
      left join work_orders wo on wo.id = ocr.order_id
      where ocr.id = $1
    `,
    [recordId]
  );
  const record = rows[0];
  if (!record) throw new HttpError(404, "OCR 记录不存在");
  if (user.role === "manager") return;
  if (user.role === "advisor" && (record.uploaded_by === user.id || record.advisor === user.name)) return;
  throw new HttpError(403, "无权访问该 OCR 记录");
}
