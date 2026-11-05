import { useEffect, useRef, useState } from "react";
import type { StoredFile, WorkOrder, WorkOrderPhotoUpdate } from "../../../../shared/types";
import { workOrderApi } from "../work-orders/api/workOrderApi";
import { prepareOcrImage, prepareUploadPhoto } from "../../shared/images/prepareOcrImage";

export function useOrderPhotoUpload(orderId: string, userId: string | undefined, onUpdated: (order: WorkOrder) => void, customer?: Pick<WorkOrder['customer'], 'contact' | 'phone'>) {
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

  async function saveWithRecovery(save: () => Promise<WorkOrder>, saved: (order: WorkOrder) => boolean) {
    try { return await save(); }
    catch (cause) {
      // A committed attachment change can lose its response. Verify the exact
      // persisted result before inviting a duplicate upload or deletion.
      try {
        const current = await workOrderApi.get(orderId);
        if (current.id === orderId && saved(current)) return current;
      } catch { /* Keep the original failure if recovery is unavailable. */ }
      throw cause;
    }
  }

  async function publishUpdated(order: WorkOrder, message: string, session: number) {
    try { await onUpdated(order); }
    catch {
      if (session === generation.current) setError(`${message}，页面更新失败，请重新打开委托单核对。`);
    }
  }

  async function uploadMany(slot: WorkOrderPhotoUpdate["slot"], files: File[], replaceFileId?: string) {
    if (running.current || !files.length) return false;
    const session = generation.current;
    running.current = true; setUploading(slot); setError(""); setSuccess(false); setSuccessMessage(""); setProgress({ completed: 0, total: files.length });
    let completed = 0;
    try {
      // Keep the whole batch locked and process images sequentially for mobile WebViews.
      for (const file of files) {
        const image = await (slot === "vehicleLicense" ? prepareOcrImage(file)
          : prepareUploadPhoto(file, slot === "front45" || slot === "rear45" ? new Date() : undefined,
            ['抚顺路4号鑫裕新能源汽修', customer?.contact?.trim() ? `联系人：${customer.contact.trim()}` : '', customer?.phone?.trim() ? `联系电话：${customer.phone.trim()}` : '']));
        if (session !== generation.current) return false;
        const kind: StoredFile["kind"] = slot === "vehicleLicense" ? "vehicle_license" : slot === "other" ? "other" : "repair_order_photo";
        const stored = await workOrderApi.uploadFile({kind, ...image});
        if (session !== generation.current) return false;
        const updated = await saveWithRecovery(() => workOrderApi.updatePhoto(orderId, {slot, fileId:stored.id, replaceFileId}), current => {
          const replaced = current.inspection.replacedPhotoIds || [];
          if (replaced.includes(stored.id) || replaceFileId && !replaced.includes(replaceFileId)
              || !current.files?.some(photo => photo.id === stored.id && photo.orderId === orderId && photo.kind === kind)) return false;
          if (slot === "vehicleLicense") return current.inspection.vehicleLicenseFileId === stored.id;
          if (slot === "other") return true;
          const photos = current.inspection.preRepairPhotos;
          return slot === "extra" ? Boolean(photos?.extra?.includes(stored.id)) : photos?.[slot] === stored.id;
        });
        if (session !== generation.current) return false;
        await publishUpdated(updated, "照片已保存", session);
        if (session !== generation.current) return false;
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
      const updated = await saveWithRecovery(() => workOrderApi.deletePhotos(orderId, { fileIds }),
        current => fileIds.every(id => current.inspection.replacedPhotoIds?.includes(id)));
      if (session !== generation.current) return false;
      await publishUpdated(updated, "照片已删除", session);
      if (session !== generation.current) return false;
      setSuccess(true); setSuccessMessage("已删除");
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
