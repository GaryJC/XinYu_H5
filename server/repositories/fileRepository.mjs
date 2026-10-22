import { hasRole, hasAnyRole } from "../../shared/roles.mjs";
import { pool, transaction } from "../database/pool.mjs";
import { createId, formatDate, nowString } from "../domain/workOrderModel.mjs";
import { HttpError } from "../http/HttpError.mjs";

export async function createFileRecord({ orderId, kind, storageProvider, bucket, objectKey, originalName, mimeType, sizeBytes, uploadedBy, uploadRequestId, database=pool }) {
  const id = createId("file");
  await database.query(
    `
      insert into files (
        id, order_id, kind, storage_provider, bucket, object_key,
        original_name, mime_type, size_bytes, uploaded_by, upload_request_id
      ) values (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11
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
      uploadedBy || null, uploadRequestId || null
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
  if (user.active && user.id && hasAnyRole(user, ["advisor", "manager"]) && file.paper_order && file.shop_id !== user.shopId) {
    const notification = await database.query("select 1 from dispatch_notifications where order_id=$1 and recipient_id=$2 and kind='纸质委托书已创建' limit 1", [file.order_id, user.id]);
    if (notification.rows.length) return;
  }
  if (!user.shopId || file.shop_id !== user.shopId) throw new HttpError(403, "无权访问其他门店文件");
  if (hasRole(user, 'manager')) return;
  if (hasRole(user, 'advisor') && (file.uploaded_by === user.id || file.advisor)) return;
  if (user.active && hasRole(user, 'warehouse') && file.kind === "repair_parts_photo" && !["草稿","待客户签字"].includes(file.status)) return;
  if (["repair_parts_photo", "repair_progress_photo", "repair_order_photo", "damage_photo", "other"].includes(file.kind)) {
    if ((hasAnyRole(user, ["technician","outsourcing"])||user.outsourcingRoleMember) && (file.technician_id === user.id || file.technician_ids?.includes(user.id))) return;
    if (hasRole(user, 'inspector') && user.inspectorRoleMember!==false && (file.inspector_id === user.id || file.stage==='待检验' && ![file.technician_id,...(file.technician_ids||[]),...(file.participant_ids||[])].includes(user.id) && !(file.items||[]).some(i=>i.startedBy===user.id || i.finishedBy===user.id))) return;
  }
  throw new HttpError(403, "无权查看该文件");
}

export async function assertFileAccess(fileId, user, database = pool) {
  const file = await findFileAccess(fileId, database);
  if (!user.shopId || file.shop_id !== user.shopId) throw new HttpError(403, "无权访问其他门店文件");
  if (hasRole(user, 'manager')) return;
  if (hasRole(user, 'advisor') && (file.uploaded_by === user.id || file.advisor === user.name)) return;
  throw new HttpError(403, "无权访问该文件");
}

async function findFileAccess(fileId, database) {
  const { rows } = await database.query(
    `
      select f.uploaded_by, f.order_id, f.kind, wo.advisor, wo.status, wo.paper_order, coalesce(wo.shop_id,u.shop_id) as shop_id, dt.technician_id, dt.data->'technicianIds' as technician_ids, dt.inspector_id, dt.stage, dt.data->'participantIds' as participant_ids, dt.data->'items' as items
      from files f
      left join work_orders wo on wo.id = f.order_id
      left join users u on u.id=f.uploaded_by
      left join dispatch_tasks dt on dt.order_id=wo.id
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
