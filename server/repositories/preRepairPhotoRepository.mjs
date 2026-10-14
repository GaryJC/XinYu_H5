import { preRepairPhotoIds } from "../domain/preRepairPhotos.mjs";
import { HttpError } from "../http/HttpError.mjs";

// Attach in the same transaction as the draft, so a failed save cannot leave
// half the photographs attached or create a second draft on retry.
export async function attachPreRepairPhotos(client, order, userId) {
  const ids = preRepairPhotoIds(order.inspection?.preRepairPhotos || {});
  if (!ids.length) return;
  const { rows } = await client.query(
    `select id from files where id = any($1::text[]) and kind = 'repair_order_photo'
      and (order_id = $2 or (order_id is null and uploaded_by = $3)) for update`,
    [ids, order.id, userId || null]
  );
  if (rows.length !== ids.length) throw new HttpError(400, "维修前照片不存在、无权使用或已关联其他委托单");
  await client.query("update files set order_id = $2 where id = any($1::text[])", [ids, order.id]);
}
