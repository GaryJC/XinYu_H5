import { useEffect, useRef, useState } from "react";
import type { StoredFile, WorkOrder, WorkOrderPhotoUpdate } from "../../../../shared/types";
import { workOrderApi } from "../work-orders/api/workOrderApi";
import { prepareOcrImage, prepareUploadPhoto } from "../../shared/images/prepareOcrImage";

export function useOrderPhotoUpload(orderId: string, userId: string | undefined, onUpdated: (order: WorkOrder) => void) {
  const [uploading, setUploading] = useState<WorkOrderPhotoUpdate["slot"] | "delete" | "">("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [progress, setProgress] = useState<{ completed: number; total: number }>();
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => { setSuccess(false); setSuccessMessage(""); }, 3000);
    return () => clearTimeout(timer);
  }, [success]);
  const running = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    running.current = false;
    setUploading(""); setError(""); setSuccess(false); setSuccessMessage(""); setProgress(undefined);
    return () => { generation.current++; };
  }, [orderId, userId]);

  async function uploadMany(slot: WorkOrderPhotoUpdate["slot"], files: File[], replaceFileId?: string) {
    if (running.current || !files.length) return false;
    const session = generation.current;
    running.current = true; setUploading(slot); setError(""); setSuccess(false); setSuccessMessage(""); setProgress({ completed: 0, total: files.length });
    let completed = 0;
    try {
      // Keep the whole batch locked and process images sequentially for mobile WebViews.
      for (const file of files) {
        const image = await (slot === "vehicleLicense" ? prepareOcrImage(file)
          : prepareUploadPhoto(file, slot === "front45" || slot === "rear45" ? new Date() : undefined));
        if (session !== generation.current) return false;
        const kind: StoredFile["kind"] = slot === "vehicleLicense" ? "vehicle_license" : slot === "other" ? "other" : "repair_order_photo";
        const stored = await workOrderApi.uploadFile({kind, ...image});
        if (session !== generation.current) return false;
        const updated = await workOrderApi.updatePhoto(orderId, {slot, fileId:stored.id, replaceFileId});
        if (session !== generation.current) return false;
        onUpdated(updated);
        completed++; setProgress({ completed, total: files.length });
      }
      setSuccess(true); setSuccessMessage(replaceFileId ? "已更换" : "已添加");
      return true;
    } catch (cause) {
      if (session === generation.current) setError(`${completed ? `已上传 ${completed} 张，剩余照片请重新选择。` : ""}${cause instanceof Error ? cause.message : "照片更新失败，请重试"}`);
      return false;
    } finally {
      if (session === generation.current) { running.current=false; setUploading(""); setProgress(undefined); }
    }
  }
  async function remove(fileIds: string[]) {
    if (running.current || !fileIds.length) return false;
    const session = generation.current;
    running.current = true; setUploading("delete"); setError(""); setSuccess(false); setSuccessMessage("");
    try {
      const updated = await workOrderApi.deletePhotos(orderId, { fileIds });
      if (session !== generation.current) return false;
      onUpdated(updated); setSuccess(true); setSuccessMessage("已删除");
      return true;
    } catch (cause) {
      if (session === generation.current) setError(cause instanceof Error ? cause.message : "照片删除失败，请重试");
      return false;
    } finally {
      if (session === generation.current) { running.current=false; setUploading(""); setProgress(undefined); }
    }
  }
  return {uploading, error, success, successMessage, progress, upload: (slot: WorkOrderPhotoUpdate["slot"], file: File, replaceFileId?: string) => uploadMany(slot, [file], replaceFileId), uploadMany, remove};
}
