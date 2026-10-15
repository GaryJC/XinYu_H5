import { Button, Image, Alert } from 'antd';
import { ImageSourcePicker } from '../../shared/ui/ImageSourcePicker';
import { AuthenticatedImage } from '../../shared/ui/AuthenticatedImage';
import { useRepairPhotos } from './useRepairPhotos';
import { displayTime } from './dispatchLabels';
import type { DispatchController } from './useDispatchController';
export function RepairPhotoPanel({controller,editable,onBlocked}:{controller:DispatchController;editable:boolean;onBlocked:(blocked:boolean)=>void}) {
  const {uploads,select,retry,remove}=useRepairPhotos(controller,onBlocked);
  const photos=controller.detail!.files.filter(f=>f.kind==='repair_progress_photo');
  return <section className="repair-photos" aria-label="维修照片">
    <h3>维修照片 <span>（选填）</span></h3>
    {editable?<ImageSourcePicker label="维修记录" primaryActionLabel="拍照记录" galleryActionLabel="相册" loading={uploads.some(p=>p.state==='uploading')} disabled={controller.busy} onSelect={select}/>:null}
    <Image.PreviewGroup><div className="repair-photo-grid">{photos.map(photo=><div key={photo.id}>
      <AuthenticatedImage fileId={photo.id} alt="维修过程照片" width="100%" height={100}/>
      <small>已保存 · {photo.uploadedName||'维修人员'}<br/>{displayTime(photo.createdAt)}</small>
    </div>)}</div></Image.PreviewGroup>
    {uploads.map(row=><div key={row.id} className="repair-photo-upload" role="status">{row.state==='uploading'?<span>照片上传中…</span>:<><Alert type="error" showIcon title="照片上传失败" description={row.error}/><Button onClick={()=>void retry(row)} disabled={!editable}>重试</Button><Button onClick={()=>remove(row.id)}>移除失败照片</Button></>}</div>)}
    {!photos.length&&!uploads.length?<p className="dispatch-muted">{editable?'维修中可以随手拍照，上传后自动保存。':'暂无维修照片'}</p>:null}
  </section>;
}
