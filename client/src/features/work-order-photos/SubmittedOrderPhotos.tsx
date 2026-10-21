import { Alert, Button, Checkbox, Empty, Popconfirm } from "antd";
import type { UserProfile, WorkOrder } from "../../../../shared/types";
import { ImageSourcePicker } from "../../shared/ui/ImageSourcePicker";
import { AuthenticatedImage, AuthenticatedImagePreviewGroup } from "../../shared/ui/AuthenticatedImage";
import { PreRepairPhotos } from "../pre-repair-photos/PreRepairPhotos";
import { PhotoBatchActions, usePhotoSelection } from "../../shared/ui/PhotoBatchActions";
import { useOrderPhotoUpload } from "./useOrderPhotoUpload";

export function SubmittedOrderPhotos({order, user, onUpdated, section = "all"}: {
  order: WorkOrder; user?: UserProfile; onUpdated:(order: WorkOrder)=>void; section?:"all"|"license"|"repair"|"other";
}) {
  const upload = useOrderPhotoUpload(order.id, user?.id, onUpdated);
  const canUpload = order.status !== "草稿" && user?.active && user.shopId === order.shop.id
    && (user.role === "manager" || user.role === "advisor" && user.name === order.advisor);
  const busy = Boolean(upload.uploading);
  const visibleFiles = (order.files || []).filter(file => !order.inspection.replacedPhotoIds?.includes(file.id));
  const otherIds = visibleFiles.filter(file => ["other", "damage_photo"].includes(file.kind)).map(file => file.id);
  const selection = usePhotoSelection(otherIds);
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
    const picker = (id?:string) => canUpload && <ImageSourcePicker label={title + (id ? "重新上传" : "上传")}
      multiple={kind === "other" && !id} galleryActionLabel={kind === "other" && !id ? "相册多选" : undefined}
      onSelectMany={kind === "other" && !id ? files => upload.uploadMany(kind, files).then(()=>{}) : undefined}
      disabled={busy} loading={upload.uploading === kind} primaryActionLabel={id ? "重新上传" : "上传照片"}
      onSelect={async file=>{await upload.upload(kind,file,id);}}/>;
    return <section className="archive-detail-section"><h3>{title}</h3>
      {canUpload && kind === "other" && <PhotoBatchActions ids={otherIds} selection={selection} disabled={busy} onRemove={upload.remove}/>}
      <AuthenticatedImagePreviewGroup fileIds={files.map(file => file.id)}><div className="archive-file-gallery">{files.map(file => <div className="archive-file-card" key={file.id}>
        <AuthenticatedImage fileId={file.id} width="100%" height={160} alt={title}/>
        {canUpload && kind === "other" && <Checkbox aria-label={`选择照片 ${file.originalName || file.id}`} disabled={busy}
          checked={selection.selectedIds.includes(file.id)} onChange={event => selection.toggle(file.id, event.target.checked)}>选择</Checkbox>}
        <span>{file.originalName || file.createdAt}</span>{picker(file.id)}
        {canUpload && <Popconfirm title="确认删除这张照片？" okText="删除" cancelText="取消" onConfirm={()=>upload.remove([file.id])}>
          <Button danger disabled={busy} aria-label={`删除${title} ${file.originalName || file.id}`}>删除照片</Button>
        </Popconfirm>}
      </div>)}</div></AuthenticatedImagePreviewGroup>
      {!files.length && <><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无图片"/>{picker()}</>}
      {kind === "other" && Boolean(files.length) && picker()}
    </section>;
  }
  return <>
    {upload.error && <Alert type="error" showIcon title={upload.error} style={{marginTop:12}}/>}
    {upload.success && <Alert type="success" showIcon title="照片已保存" style={{marginTop:12}}/>}
    {["all","repair"].includes(section) && <PreRepairPhotos required={!order.paperOrder} photos={order.inspection.preRepairPhotos} disabled={!canUpload} controls={controls}/>}
    {["all","license"].includes(section) && gallery("vehicleLicense", "行驶证照片")}
    {["all","other"].includes(section) && gallery("other", "其他照片")}
  </>;
}
