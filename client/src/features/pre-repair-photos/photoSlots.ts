import type { PreRepairPhotos } from "../../../../shared/types";

export const photoSlots = [
  { key: "front45", label: "斜前方 45°", required: true, hint: "站在左前角，拍到完整车头和左侧车身" },
  { key: "rear45", label: "斜后方 45°", required: true, hint: "站在右后角，拍到完整车尾和右侧车身" },
  { key: "mileage", label: "公里数 / 仪表盘", required: false, hint: "点亮仪表盘，清晰拍出总公里数和单位" }
] as const;

export type PhotoSlot = typeof photoSlots[number]["key"];

export function missingPhotoErrors(photos: PreRepairPhotos = {}) {
  return photoSlots.filter((slot) => slot.required && !photos[slot.key]).map((slot) => `请上传维修前${slot.label}照片`);
}
