import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { WorkOrderDraft } from "../../../../../shared/types";
import { prepareUploadPhoto } from "../../../shared/images/prepareOcrImage";
import { workOrderApi } from "../api/workOrderApi";

export function usePaperOrderPhotos(setDraft: Dispatch<SetStateAction<WorkOrderDraft>>) {
  const generation = useRef(0);
  const running = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  function reset() { generation.current++; running.current=false; setUploading(false); setError(""); }
  async function upload(files: File[]) {
    if (running.current || !files.length) return;
    const session=generation.current;
    running.current=true; setUploading(true); setError("");
    try {
      for (const file of files) {
        const image=await prepareUploadPhoto(file);
        if (session!==generation.current) return;
        const stored=await workOrderApi.uploadFile({kind:"other",...image});
        if (session!==generation.current) return;
        setDraft(current=>({...current,paperOrder:{mode:current.paperOrder?.mode || "pending",photoIds:[...(current.paperOrder?.photoIds || []),stored.id]}}));
      }
    } catch(cause) { if(session===generation.current) setError(cause instanceof Error ? cause.message : "纸质委托书上传失败"); }
    finally { if(session===generation.current) {running.current=false;setUploading(false);} }
  }
  function remove(id:string) { setDraft(current=>({...current,paperOrder:current.paperOrder ? {...current.paperOrder,photoIds:current.paperOrder.photoIds.filter(value=>value!==id)} : undefined})); }
  function removeMany(ids: string[]) {
    if (running.current) return;
    setDraft(current => ({ ...current, paperOrder: current.paperOrder ? {
      ...current.paperOrder, photoIds: current.paperOrder.photoIds.filter(id => !ids.includes(id))
    } : undefined }));
  }
  return {uploading,error,reset,upload,remove,removeMany,isUploading:()=>running.current};
}
