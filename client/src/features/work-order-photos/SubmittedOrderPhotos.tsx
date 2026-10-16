import { PhotoPreviewGroup } from "../../shared/ui/PhotoPreviewGroup";
import { Alert, Empty } from "antd";
import type { UserProfile, WorkOrder } from "../../../../shared/types";
import { ImageSourcePicker } from "../../shared/ui/ImageSourcePicker";
import { AuthenticatedImage } from "../../shared/ui/AuthenticatedImage";
import { PreRepairPhotos } from "../pre-repair-photos/PreRepairPhotos";
import { useOrderPhotoUpload } from "./useOrderPhotoUpload";

export function SubmittedOrderPhotos({order, user, onUpdated, section = "all"}: {
  order: WorkOrder; user?: UserProfile; onUpdated:(order: WorkOrder)=>void; section?:"all"|"license"|"repair";
}) {
  const upload = useOrderPhotoUpload(order.id, user?.id, onUpdated);
  const canUpload = order.status !== "草稿" && user?.active && user.shopId === order.shop.id
    && (user.role === "manager" || user.role === "advisor" && user.name === order.advisor);
  const busy = Boolean(upload.uploading);
  const visibleFiles = (order.files || []).filter(file => !order.inspection.replacedPhotoIds?.includes(file.id));
  const controls = canUpload ? {
    uploading: upload.uploading, error: upload.error,
    upload: (slot: "front45"|"rear45"|"mileage"|"extra", file: File, replaceFileId?:string) => upload.upload(slot, file, replaceFileId).then(()=>{}),
    uploadExtras: async (files: File[]) => { for (const file of files) { if (!await upload.upload("extra", file)) break; } },
    replaceExtra: (id:string,file:File) => upload.upload("extra",file,id).then(()=>{})
  } : undefined;
  function gallery(kind: "vehicleLicense"|"other", title: string) {
    const files = visibleFiles.filter(file => kind === "vehicleLicense" ? file.kind === "vehicle_license" : ["other","damage_photo"].includes(file.kind));
    const picker = (id?:string) => canUpload && <ImageSourcePicker label={title + (id ? "重新上传" : "上传")}
      disabled={busy} loading={upload.uploading === kind} primaryActionLabel={id ? "重新上传" : "上传照片"}
      onSelect={async file=>{await upload.upload(kind,file,id);}}/>;
    return <section className="archive-detail-section"><h3>{title}</h3>
      <PhotoPreviewGroup><div className="archive-file-gallery">{files.map(file => <div className="archive-file-card" key={file.id}>
        <AuthenticatedImage fileId={file.id} width="100%" height={160} alt={title}/>
        <span>{file.originalName || file.createdAt}</span>{picker(file.id)}
      </div>)}</div></PhotoPreviewGroup>
      {!files.length && <><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无图片"/>{picker()}</>}
      {kind === "other" && Boolean(files.length) && picker()}
    </section>;
  }
  return <>
    {upload.error && <Alert type="error" showIcon title={upload.error} style={{marginTop:12}}/>}
    {upload.success && <Alert type="success" showIcon title="照片已保存" style={{marginTop:12}}/>}
    {section !== "license" && <PreRepairPhotos photos={order.inspection.preRepairPhotos} disabled={!canUpload} controls={controls}/>}
    {section !== "repair" && gallery("vehicleLicense", "行驶证照片")}
    {section === "all" && gallery("other", "其他照片")}
  </>;
}
