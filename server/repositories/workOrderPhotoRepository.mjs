import {selectSingleVehicleLicense,assertLicenseReuseIdentity} from './vehicleLicenseHistoryRepository.mjs';
import { hasRole, hasAnyRole } from "../../shared/roles.mjs";
import { HttpError } from "../http/HttpError.mjs";
import { assertPaperPhotoIds } from "./paperOrderRepository.mjs";
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
  const order = await lockPhotoOrder(client, id, actor);
  const { rows: files } = await client.query("select * from files where id=$1 for update", [input.fileId]);
  const file = files[0];
  if (!file || file.kind !== slot.kind || !/^image\/(jpeg|png|webp)$/.test(file.mime_type || "")
      || (file.order_id ? file.order_id !== id : file.uploaded_by !== actor.id)) {
    throw new HttpError(400, "照片不存在、类型不符、无权使用或已关联其他委托单");
  }
  const inspection = { ...(order.inspection || {}) };
  if ((inspection.replacedPhotoIds || []).includes(file.id)) throw new HttpError(409, "不能复用已替换的历史照片，请重新上传");
  if (input.slot === "vehicleLicense") {assertLicenseReuseIdentity(file,order.vehicle_vin);inspection.vehicleLicenseFileId = file.id;}
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
  const replacesPaperPhoto = order.paper_order?.photoIds?.includes(input.replaceFileId);
  const addsPendingPaperPhoto = order.paper_order?.mode === "pending" && !input.replaceFileId;
  if (input.slot === "other" && (replacesPaperPhoto || addsPendingPaperPhoto)) {
    const photoIds = replacesPaperPhoto
      ? order.paper_order.photoIds.map(photoId => photoId === input.replaceFileId ? file.id : photoId)
      : [...order.paper_order.photoIds, file.id];
    const paper = { ...order.paper_order, photoIds: [...new Set(photoIds)] };
    assertPaperPhotoIds(paper);
    await client.query("update work_orders set paper_order=$2::jsonb where id=$1", [id, JSON.stringify(paper)]);
  }
  await client.query("update files set order_id=$2 where id=$1", [file.id, id]);
  await client.query("update ocr_records set order_id=$2 where file_id=$1 and (order_id is null or order_id=$2)", [file.id, id]);
  if(input.slot === "vehicleLicense")Object.assign(inspection,await selectSingleVehicleLicense(client,id,file.id,inspection,order.vehicle_vin));
  // Only attachment metadata changes. Signed fields, workflow and Runfeng outbox stay untouched.
  await client.query("update work_orders set inspection=$2::jsonb,updated_at=now() where id=$1", [id, JSON.stringify(inspection)]);
  await client.query("insert into audit_logs(order_id,actor,action) values($1,$2,$3)",
    [id, actor.name, `补传/更新${slot.label}（文件 ${file.id}），保留原照片`]);
}

async function lockPhotoOrder(client, id, actor) {
  const { rows: orders } = await client.query("select * from work_orders where id=$1 for update", [id]);
  const order = orders[0];
  if (!order) throw new HttpError(404, "委托单不存在");
  if (!actor?.active || !actor.shopId || actor.shopId !== order.shop_id
      || !hasAnyRole(actor, ["manager", "advisor"])
      || (!hasRole(actor, 'manager') && hasRole(actor, 'advisor') && actor.name !== order.advisor)) throw new HttpError(403, "无权更新该委托单照片");
  if (order.status === "草稿") throw new HttpError(409, "草稿请在开单页面上传照片并保存");
  return order;
}

export async function removeWorkOrderPhotos(client, id, input, actor) {
  const ids = input?.fileIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 100
      || ids.some(value => typeof value !== "string" || !value.trim()) || new Set(ids).size !== ids.length) {
    throw new HttpError(400, "请选择要删除的照片（每次最多 100 张）");
  }
  const order = await lockPhotoOrder(client, id, actor);
  const inspection = { ...(order.inspection || {}) };
  const { rows: files } = await client.query("select * from files where id=any($1::text[]) and order_id=$2 for update", [ids, id]);
  const allowedKinds = new Set(Object.values(slots).map(slot => slot.kind).concat("damage_photo"));
  if (files.length !== ids.length || files.some(file => !allowedKinds.has(file.kind)
      || !/^image\/(jpeg|png|webp)$/.test(file.mime_type || "") || (inspection.replacedPhotoIds || []).includes(file.id))) {
    throw new HttpError(409, "照片不存在、已变更或不允许删除，请刷新后重试");
  }
  const removed = new Set(ids);
  const photos = { ...(inspection.preRepairPhotos || {}) };
  for (const key of ["front45", "rear45", "mileage"]) if (removed.has(photos[key])) delete photos[key];
  photos.extra = (photos.extra || []).filter(fileId => !removed.has(fileId));
  inspection.preRepairPhotos = photos;
  if (removed.has(inspection.vehicleLicenseFileId)) delete inspection.vehicleLicenseFileId;
  inspection.replacedPhotoIds = [...new Set([...(inspection.replacedPhotoIds || []), ...ids])];
  if (order.paper_order?.photoIds?.some(fileId => removed.has(fileId))) {
    const paper = { ...order.paper_order, photoIds: order.paper_order.photoIds.filter(fileId => !removed.has(fileId)) };
    if (!paper.photoIds.length) throw new HttpError(409, "纸质委托书至少保留一张照片，请先上传新照片再删除");
    assertPaperPhotoIds(paper);
    await client.query("update work_orders set paper_order=$2::jsonb where id=$1", [id, JSON.stringify(paper)]);
  }
  await client.query("update work_orders set inspection=$2::jsonb,updated_at=now() where id=$1", [id, JSON.stringify(inspection)]);
  await client.query("insert into audit_logs(order_id,actor,action) values($1,$2,$3)",
    [id, actor.name, `删除委托单照片 ${ids.length} 张（文件 ${ids.join("、")}），保留原文件`]);
}
