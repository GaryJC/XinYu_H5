import { Alert, Button } from "antd";
import type { PreRepairPhotos as Photos } from "../../../../shared/types";
import { AuthenticatedImage, AuthenticatedImagePreviewGroup } from "../../shared/ui/AuthenticatedImage";
import { ImageSourcePicker } from "../../shared/ui/ImageSourcePicker";
import { PhotoGuide } from "./PhotoGuide";
import { photoSlots } from "./photoSlots";
import type { PhotoSlot } from "./photoSlots";
import "./photos.css";

type Props = {
  photos?: Photos;
  disabled: boolean;
  controls?: {
    uploading: string; error: string;
    upload:(slot:PhotoSlot|"extra",file:File)=>Promise<void>;
    uploadExtras:(files:File[])=>Promise<void>;
    removeExtra?:(id:string)=>void; removeMileage?:()=>void;
    replaceExtra?:(id:string,file:File)=>Promise<void>;
  };
  errors?: string[];
};

export function PreRepairPhotos({ photos = {}, disabled, controls, errors = [] }: Props) {
  const busy = Boolean(controls?.uploading);
  return <section className="pre-repair-photos" aria-label="车辆维修前照片">
    <div className="pre-repair-photos-heading"><h3>车辆维修前照片</h3><span>{photoSlots.filter((slot) => slot.required && photos[slot.key]).length}/2 必传</span></div>
    <p>请拍摄车辆左前方与右后方，覆盖车头、车尾和两侧全貌；公里数照片可选上传。</p>
    {controls?.error && <Alert type="error" showIcon message={controls.error} />}
    <AuthenticatedImagePreviewGroup fileIds={[...photoSlots.map((slot) => photos[slot.key]).filter((id): id is string => Boolean(id)), ...(photos.extra || [])]}><div className="pre-repair-photo-grid">
      {photoSlots.map((slot) => {
        const id = photos[slot.key];
        const error = errors.find((message) => message.includes(slot.label));
        return <div key={slot.key} className={`pre-repair-photo-card${error ? " has-error" : ""}`}>
          <div className="pre-repair-photo-label"><span>{slot.required && <b aria-hidden="true">*</b>} {slot.label}</span><small>{id ? "已上传" : slot.required ? "必传" : "选填"}</small></div>
          <div className="pre-repair-photo-cover">{id
            ? <AuthenticatedImage fileId={id} alt={`${slot.label}维修前照片`} width="100%" height={160} />
            : <PhotoGuide slot={slot.key} />}</div>
          <p>{slot.hint}</p>
          {!disabled && controls && <ImageSourcePicker disabled={busy} loading={controls.uploading === slot.key} label={`${slot.label}照片`} primaryActionLabel={id ? "重新拍摄" : "拍照上传"} onSelect={(file) => controls.upload(slot.key, file)} />}
          {!disabled && controls?.removeMileage && slot.key === "mileage" && id && <Button type="link" danger disabled={busy} onClick={controls.removeMileage} aria-label="移除公里数照片">移除</Button>}
          {error && <div className="pre-repair-photo-error" role="alert">{error}</div>}
        </div>;
      })}
      {(photos.extra || []).map((id, index) => <div className="pre-repair-photo-card" key={id}>
        <div className="pre-repair-photo-label">额外照片 {index + 1}</div>
        <div className="pre-repair-photo-cover"><AuthenticatedImage fileId={id} alt={`维修前额外照片 ${index + 1}`} width="100%" height={160} /></div>
        {!disabled && controls?.replaceExtra && <ImageSourcePicker label={`额外照片 ${index + 1}重新上传`} primaryActionLabel="重新上传"
          disabled={busy} loading={controls.uploading === "extra"} onSelect={file => controls.replaceExtra!(id,file)}/>}
        {!disabled && controls?.removeExtra && <Button danger disabled={busy} onClick={() => controls.removeExtra?.(id)} aria-label={`移除额外照片 ${index + 1}`}>移除</Button>}
      </div>)}
      {!disabled && controls && <div className="pre-repair-photo-card pre-repair-photo-extra">
        <div className="pre-repair-photo-label">额外照片 <small>选填</small></div>
        <div className="pre-repair-extra-icon" aria-hidden="true">＋</div>
        <p>可补充划痕、凹陷、内饰或其他细节照片</p>
        <ImageSourcePicker disabled={busy} loading={controls.uploading === "extra"} label="维修前额外照片" multiple onSelectMany={controls.uploadExtras} galleryActionLabel="相册多选" primaryActionLabel="添加照片" onSelect={(file) => controls.upload("extra", file)} />
      </div>}
    </div></AuthenticatedImagePreviewGroup>
  </section>;
}
