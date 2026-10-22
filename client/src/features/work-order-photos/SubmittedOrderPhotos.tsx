import { hasRole } from "../../../../shared/roles.mjs";
import { Alert } from "antd";
import type { UserProfile, WorkOrder } from "../../../../shared/types";
import { OrderPhotoGallery } from "./OrderPhotoGallery";
import { PreRepairPhotos } from "../pre-repair-photos/PreRepairPhotos";
import { useOrderPhotoUpload } from "./useOrderPhotoUpload";

export function SubmittedOrderPhotos({order, user, onUpdated, section = "all"}: {
  order: WorkOrder; user?: UserProfile; onUpdated:(order: WorkOrder)=>void; section?:"all"|"license"|"repair"|"other";
}) {
  const upload = useOrderPhotoUpload(order.id, user?.id, onUpdated);
  const canUpload = order.status !== "草稿" && user?.active && user.shopId === order.shop.id
    && (hasRole(user, 'manager') || hasRole(user, 'advisor') && user.name === order.advisor);
  const busy = Boolean(upload.uploading);
  const visibleFiles = (order.files || []).filter(file => !order.inspection.replacedPhotoIds?.includes(file.id));
  const controls = canUpload ? {
    uploading: upload.uploading, error: upload.error,
    upload: (slot: "front45"|"rear45"|"mileage"|"extra", file: File, replaceFileId?:string) => upload.upload(slot, file, replaceFileId).then(()=>{}),
    uploadExtras: (files: File[]) => upload.uploadMany("extra", files).then(()=>{}),
    removeExtra: (id: string) => { void upload.remove([id]); },
    removeExtras: (ids: string[]) => upload.remove(ids),
    removePhoto: (id: string) => { void upload.remove([id]); },
    replaceExtra: (id:string,file:File) => upload.upload("extra",file,id).then(()=>{})
  } : undefined;
  function gallery(kind: "vehicleLicense"|"other", title: string) {
    const files = visibleFiles.filter(file => kind === "vehicleLicense" ? file.kind === "vehicle_license" : ["other","damage_photo"].includes(file.kind));
    return <OrderPhotoGallery key={`${order.id}-${kind}`} title={title} files={files} editable={Boolean(canUpload)} busy={busy} multiple={kind==='other'}
      onUpload={(files,replaceId)=>upload.uploadMany(kind,files,replaceId)} onRemove={upload.remove}/>;
  }
  return <>
    {upload.error && <Alert type="error" showIcon title={upload.error} style={{marginTop:12}}/>}
    {upload.success && <Alert type="success" showIcon title="照片已保存" style={{marginTop:12}}/>}
    {["all","repair"].includes(section) && <PreRepairPhotos required={!order.paperOrder} photos={order.inspection.preRepairPhotos} disabled={!canUpload} controls={controls}/>}
    {["all","license"].includes(section) && gallery("vehicleLicense", "行驶证照片")}
    {["all","other"].includes(section) && gallery("other", "其他照片")}
  </>;
}
