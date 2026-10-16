import { useEffect, useRef, useState } from "react";
import type { StoredFile, WorkOrder, WorkOrderPhotoUpdate } from "../../../../shared/types";
import { workOrderApi } from "../work-orders/api/workOrderApi";
import { prepareOcrImage } from "../../shared/images/prepareOcrImage";

export function useOrderPhotoUpload(orderId: string, userId: string | undefined, onUpdated: (order: WorkOrder) => void) {
  const [uploading, setUploading] = useState<WorkOrderPhotoUpdate["slot"] | "">("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const running = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    running.current = false;
    setUploading(""); setError(""); setSuccess(false);
    return () => { generation.current++; };
  }, [orderId, userId]);
  async function upload(slot: WorkOrderPhotoUpdate["slot"], file: File, replaceFileId?: string) {
    if (running.current) return false;
    const session = generation.current;
    running.current = true; setUploading(slot); setError(""); setSuccess(false);
    try {
      const image = await prepareOcrImage(file);
      if (session !== generation.current) return false;
      const kind: StoredFile["kind"] = slot === "vehicleLicense" ? "vehicle_license" : slot === "other" ? "other" : "repair_order_photo";
      const stored = await workOrderApi.uploadFile({kind, ...image});
      if (session !== generation.current) return false;
      const updated = await workOrderApi.updatePhoto(orderId, {slot, fileId:stored.id, replaceFileId});
      if (session !== generation.current) return false;
      onUpdated(updated); setSuccess(true);
      return true;
    } catch (cause) {
      if (session === generation.current) setError(cause instanceof Error ? cause.message : "照片更新失败，请重试");
      return false;
    } finally {
      if (session === generation.current) { running.current=false; setUploading(""); }
    }
  }
  return {uploading, error, success, upload};
}
