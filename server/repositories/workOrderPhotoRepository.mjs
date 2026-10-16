import { HttpError } from "../http/HttpError.mjs";
import { preRepairPhotoIds } from "../domain/preRepairPhotos.mjs";

const slots = {
  vehicleLicense: { kind: "vehicle_license", label: "行驶证照片" },
  front45: { kind: "repair_order_photo", label: "斜前方45度照片" },
  rear45: { kind: "repair_order_photo", label: "斜后方45度照片" },
  mileage: { kind: "repair_order_photo", label: "公里数照片" },
  extra: { kind: "repair_order_photo", label: "额外照片" },
  other: { kind: "other", label: "其他照片" }
};

export async function updateWorkOrderPhoto(client, id, input, actor) {
  if (!input || typeof input.fileId !== "string" || !input.fileId.trim()
      || !Object.hasOwn(slots, input.slot)
      || input.fileId === input.replaceFileId
      || (input.replaceFileId !== undefined && (typeof input.replaceFileId !== "string" || !input.replaceFileId.trim()))) throw new HttpError(400, "照片参数不正确");
  const slot = slots[input.slot];
  const { rows: orders } = await client.query("select * from work_orders where id=$1 for update", [id]);
  const order = orders[0];
  if (!order) throw new HttpError(404, "委托单不存在");
  if (!actor?.active || !actor.shopId || actor.shopId !== order.shop_id
      || !["manager", "advisor"].includes(actor.role)
      || (actor.role === "advisor" && actor.name !== order.advisor)) throw new HttpError(403, "无权更新该委托单照片");
  if (order.status === "草稿") throw new HttpError(409, "草稿请在开单页面上传照片并保存");
  const { rows: files } = await client.query("select * from files where id=$1 for update", [input.fileId]);
  const file = files[0];
  if (!file || file.kind !== slot.kind || !/^image\/(jpeg|png|webp)$/.test(file.mime_type || "")
      || (file.order_id ? file.order_id !== id : file.uploaded_by !== actor.id)) {
    throw new HttpError(400, "照片不存在、类型不符、无权使用或已关联其他委托单");
  }
  const inspection = { ...(order.inspection || {}) };
  if ((inspection.replacedPhotoIds || []).includes(file.id)) throw new HttpError(409, "不能复用已替换的历史照片，请重新上传");
  if (input.slot === "vehicleLicense") inspection.vehicleLicenseFileId = file.id;
  if (input.replaceFileId) {
    const {rows: previousFiles} = await client.query("select * from files where id=$1 and order_id=$2", [input.replaceFileId, id]);
    const previous = previousFiles[0];
    if (!previous || !(previous.kind === slot.kind || input.slot === "other" && previous.kind === "damage_photo"))
      throw new HttpError(400, "原照片不存在或类型不符");
    if ((inspection.replacedPhotoIds || []).includes(previous.id)) throw new HttpError(409, "照片已更新，请刷新后重试");
    inspection.replacedPhotoIds = [...new Set([...(inspection.replacedPhotoIds || []), previous.id])];
  }
  if (slot.kind === "repair_order_photo") {
    const photos = { ...(inspection.preRepairPhotos || {}) };
    if (input.slot === "extra") {
      if (input.replaceFileId && !(photos.extra || []).includes(input.replaceFileId)) throw new HttpError(409, "额外照片已变更，请刷新后重试");
      photos.extra = input.replaceFileId ? photos.extra.map(id => id === input.replaceFileId ? file.id : id)
        : [...new Set([...(photos.extra || []), file.id])];
    }
    else photos[input.slot] = file.id;
    preRepairPhotoIds(photos);
    inspection.preRepairPhotos = photos;
  }
  await client.query("update files set order_id=$2 where id=$1", [file.id, id]);
  await client.query("update ocr_records set order_id=$2 where file_id=$1 and (order_id is null or order_id=$2)", [file.id, id]);
  // Only attachment metadata changes. Signed fields, workflow and Runfeng outbox stay untouched.
  await client.query("update work_orders set inspection=$2::jsonb,updated_at=now() where id=$1", [id, JSON.stringify(inspection)]);
  await client.query("insert into audit_logs(order_id,actor,action) values($1,$2,$3)",
    [id, actor.name, `补传/更新${slot.label}（文件 ${file.id}），保留原照片`]);
}
