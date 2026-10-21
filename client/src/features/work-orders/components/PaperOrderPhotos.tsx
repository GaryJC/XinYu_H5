import { useState } from "react";
import { Alert, Button, Checkbox, Popover, Spin } from "antd";
import { Plus, X } from "lucide-react";
import { PhotoBatchActions, usePhotoSelection } from "../../../shared/ui/PhotoBatchActions";
import { ImageSourcePicker } from "../../../shared/ui/ImageSourcePicker";
import { AuthenticatedImage, AuthenticatedImagePreviewGroup } from "../../../shared/ui/AuthenticatedImage";
import type { usePaperOrderPhotos } from "../hooks/usePaperOrderPhotos";
import "../paper-order.css";

export function PaperOrderPhotos({ids,disabled,controls}:{ids:string[];disabled:boolean;controls:ReturnType<typeof usePaperOrderPhotos>}) {
  const selection = usePhotoSelection(ids);
  const [pickerOpen, setPickerOpen] = useState(false);
  const picker = <div className="paper-order-source-picker"><ImageSourcePicker label="纸质委托书照片" multiple disabled={disabled || controls.uploading}
    primaryActionLabel="拍照上传委托书" onSelect={file=>{setPickerOpen(false);return controls.upload([file]);}}
    onSelectMany={files=>{setPickerOpen(false);return controls.upload(files);}} /></div>;
  return <section className="paper-order-photos" aria-label="纸质委托书照片">
    <p>请上传清晰完整的纸质委托书照片，可上传多张。</p>
    {!disabled && <PhotoBatchActions ids={ids} selection={selection} disabled={controls.uploading} onRemove={controls.removeMany}/>}
    <AuthenticatedImagePreviewGroup fileIds={ids}><div className="paper-order-photo-grid">{ids.map((id, index)=><div className="paper-order-photo-card" key={id}>
      {!disabled && <Checkbox className="paper-order-photo-select" aria-label={`选择纸质委托书照片 ${index + 1}`} disabled={controls.uploading}
        checked={selection.selectedIds.includes(id)} onChange={event=>selection.toggle(id,event.target.checked)}/>}
      <AuthenticatedImage fileId={id} width="100%" height="100%" alt={`纸质委托书照片 ${index + 1}`}/>
      {!disabled && <Button className="paper-order-photo-remove" danger shape="circle" aria-label={`移除照片 ${index + 1}`} title="移除照片"
        icon={<X size={18} aria-hidden="true" />} disabled={controls.uploading} onClick={()=>controls.remove(id)} />}
    </div>)}
      {!disabled && <Popover content={picker} trigger="click" placement="bottom" open={pickerOpen && !controls.uploading} onOpenChange={setPickerOpen}>
        <Button className="paper-order-photo-add" disabled={controls.uploading} aria-label="添加纸质委托书照片" aria-expanded={pickerOpen && !controls.uploading}>
          {controls.uploading ? <Spin size="small" /> : <Plus size={28} aria-hidden="true" />}
          <span>{controls.uploading ? "上传中…" : "添加照片"}</span>
        </Button>
      </Popover>}
    </div></AuthenticatedImagePreviewGroup>
    {controls.error && <Alert type="error" showIcon title={controls.error}/>}
  </section>;
}
