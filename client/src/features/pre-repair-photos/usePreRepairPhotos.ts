import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { WorkOrderDraft } from "../../../../shared/types";
import { prepareOcrImage } from "../../shared/images/prepareOcrImage";
import { workOrderApi } from "../work-orders/api/workOrderApi";
import type { PhotoSlot } from "./photoSlots";

export function usePreRepairPhotos(setDraft: Dispatch<SetStateAction<WorkOrderDraft>>) {
  const generation = useRef(0);
  const inFlight = useRef(false);
  const [uploading, setUploading] = useState<PhotoSlot | "extra" | "">("");
  const [error, setError] = useState("");

  function reset() {
    generation.current++;
    inFlight.current = false;
    setUploading("");
    setError("");
  }

  async function uploadMany(slot: PhotoSlot | "extra", files: File[]) {
    if (inFlight.current || !files.length) return;
    if (files.some((file) => !file.type.startsWith("image/"))) { setError("请选择照片文件"); return; }
    inFlight.current = true;
    const session = generation.current;
    setUploading(slot);
    setError("");
    let completed = 0;
    try {
      // Upload sequentially to avoid overwhelming mobile WebViews with large images.
      for (const file of files) {
        const image = await prepareOcrImage(file);
        if (generation.current !== session) return;
        const stored = await workOrderApi.uploadFile({ kind: "repair_order_photo", ...image });
        if (generation.current !== session) return;
        setDraft((current) => {
          const photos = current.inspection.preRepairPhotos || {};
          return { ...current, inspection: { ...current.inspection, preRepairPhotos: {
            ...photos,
            ...(slot === "extra" ? { extra: [...(photos.extra || []), stored.id] } : { [slot]: stored.id })
          } } };
        });
        completed++;
      }
    } catch (cause) {
      if (generation.current === session) setError(`${completed ? `已上传 ${completed} 张，剩余照片请重新选择。` : ""}${cause instanceof Error ? cause.message : "照片上传失败，请重试"}`);
    } finally {
      if (generation.current === session) { inFlight.current = false; setUploading(""); }
    }
  }

  function upload(slot: PhotoSlot | "extra", file: File) {
    return uploadMany(slot, [file]);
  }

  function uploadExtras(files: File[]) {
    return uploadMany("extra", files);
  }

  function removeExtra(id: string) {
    setDraft((current) => ({ ...current, inspection: { ...current.inspection, preRepairPhotos: {
      ...current.inspection.preRepairPhotos,
      extra: current.inspection.preRepairPhotos?.extra?.filter((fileId) => fileId !== id)
    } } }));
  }

  function removeMileage() {
    setDraft((current) => ({ ...current, inspection: { ...current.inspection, preRepairPhotos: {
      ...current.inspection.preRepairPhotos, mileage: undefined
    } } }));
  }

  return { uploading, error, upload, uploadExtras, reset, removeExtra, removeMileage, isUploading: () => inFlight.current };
}
