import { pool, transaction } from "../database/pool.mjs";
import { createId, formatDate, nowString } from "../domain/workOrderModel.mjs";
import { HttpError } from "../http/HttpError.mjs";

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

export async function findFileRecord(fileId) {
  const { rows } = await pool.query("select * from files where id = $1", [fileId]);
  const row = rows[0];
  if (!row) throw new HttpError(404, "文件不存在");
  return mapFileRecord(row);
}

export async function attachFileToOrder(fileId, orderId, runTransaction = transaction) {
  return runTransaction(async (client) => {
    const { rows } = await client.query(
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
    await client.query(
      "update ocr_records set order_id = $2 where file_id = $1 and (order_id is null or order_id = $2)",
      [fileId, orderId]
    );
    return mapFileRecord(row);
  });
}

export async function assertFileReadAccess(fileId, user, database = pool) {
  const file = await findFileAccess(fileId, database);
  if (user.role === "manager") return;
  if (user.role === "advisor" && (file.uploaded_by === user.id || file.advisor)) return;
  throw new HttpError(403, "无权查看该文件");
}

export async function assertFileAccess(fileId, user, database = pool) {
  const file = await findFileAccess(fileId, database);
  if (user.role === "manager") return;
  if (user.role === "advisor" && (file.uploaded_by === user.id || file.advisor === user.name)) return;
  throw new HttpError(403, "无权访问该文件");
}

async function findFileAccess(fileId, database) {
  const { rows } = await database.query(
    `
      select f.uploaded_by, wo.advisor
      from files f
      left join work_orders wo on wo.id = f.order_id
      where f.id = $1
    `,
    [fileId]
  );
  const file = rows[0];
  if (!file) throw new HttpError(404, "文件不存在");
  return file;
}

function mapFileRecord(row) {
  return {
    id: row.id,
    orderId: row.order_id || undefined,
    kind: row.kind,
    storageProvider: row.storage_provider,
    bucket: row.bucket,
    objectKey: row.object_key,
    originalName: row.original_name || "",
    mimeType: row.mime_type || "application/octet-stream",
    sizeBytes: Number(row.size_bytes || 0),
    uploadedBy: row.uploaded_by || undefined,
    createdAt: formatDate(row.created_at)
  };
}
