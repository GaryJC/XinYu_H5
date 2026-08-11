import { pool, transaction } from "../database/pool.mjs";
import { createId, rowToOcrRecord } from "../domain/workOrderModel.mjs";
import { HttpError } from "../http/HttpError.mjs";

export async function createOcrRecord({ orderId, field, source, fileId, value, confidence, error }, database = pool) {
  if (!fileId || typeof fileId !== "string") throw new HttpError(400, "OCR 记录缺少有效文件");
  const id = createId("ocr");
  const status = error ? "识别失败" : "待确认";
  await database.query(
    `
      insert into ocr_records (id, order_id, field, source, file_id, status, value, confidence, error)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [id, orderId || null, field, source, fileId, status, value || "", Number(confidence || 0), error || null]
  );
  if (orderId) {
    await database.query(
      "insert into audit_logs (order_id, actor, action) values ($1, $2, $3)",
      [orderId, "OCR", `${source}识别${error ? "失败" : "待确认"}`]
    );
  }
  return findOcrRecord(id, database);
}

export async function confirmOcrRecord(
  id,
  value,
  actor,
  { database = pool, runTransaction = transaction } = {}
) {
  await runTransaction(async (client) => {
    const record = await findOcrRecord(id, client, true);
    if (!record) throw new HttpError(404, "OCR 记录不存在");
    if (record.status === "已确认") return;
    await client.query(
      "update ocr_records set status = '已确认', value = $2, confirmed_at = now() where id = $1",
      [id, value || record.value]
    );
    if (record.orderId) {
      await client.query(
        "insert into audit_logs (order_id, actor, action) values ($1, $2, $3)",
        [record.orderId, actor || "服务顾问", `确认OCR字段：${record.field}`]
      );
    }
  });
  return findOcrRecord(id, database);
}

async function findOcrRecord(id, database, forUpdate = false) {
  const { rows } = await database.query(
    `select * from ocr_records where id = $1${forUpdate ? " for update" : ""}`,
    [id]
  );
  return rows[0] ? rowToOcrRecord(rows[0]) : undefined;
}
