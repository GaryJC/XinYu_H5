import { HttpError } from "../http/HttpError.mjs";

const requiredPhotos = { front45: "斜前方 45°照片", rear45: "斜后方 45°照片" };
const photoKeys = [...Object.keys(requiredPhotos), "mileage"];

export function preRepairPhotoIds(photos = {}) {
  if (!photos || typeof photos !== "object" || Array.isArray(photos)) throw new HttpError(400, "维修前照片格式不正确");
  if (photos.extra !== undefined && !Array.isArray(photos.extra)) throw new HttpError(400, "额外照片格式不正确");
  const ids = [...photoKeys.map((key) => photos[key]).filter((id) => id !== undefined), ...(photos.extra || [])];
  if (ids.some((id) => typeof id !== "string" || !id.trim())) throw new HttpError(400, "维修前照片文件 ID 不正确");
  if (new Set(ids).size !== ids.length) throw new HttpError(400, "请分别上传不同的维修前照片");
  return ids;
}

export function assertPreRepairPhotosReady(order) {
  const photos = order.inspection?.preRepairPhotos || {};
  preRepairPhotoIds(photos);
  const missing = Object.entries(requiredPhotos).filter(([key]) => !photos[key]).map(([, label]) => label);
  if (missing.length) throw new HttpError(400, `请上传维修前照片：${missing.join("、")}`);
  const files = new Set((order.files || []).filter((file) => file.kind === "repair_order_photo" && file.orderId === order.id).map((file) => file.id));
  if (preRepairPhotoIds(photos).some((id) => !files.has(id))) throw new HttpError(400, "维修前照片未关联当前委托单，请重新上传并保存");
}
