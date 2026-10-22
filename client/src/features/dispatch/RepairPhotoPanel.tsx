import { Button, Image, Alert, Popconfirm } from 'antd';
import { ImageSourcePicker } from '../../shared/ui/ImageSourcePicker';
import { AuthenticatedImage } from '../../shared/ui/AuthenticatedImage';
import { useRepairPhotos } from './useRepairPhotos';
import { displayTime } from './dispatchLabels';
import type { DispatchController } from './useDispatchController';
export function RepairPhotoPanel({controller,editable,onBlocked,ownerId}:{controller:DispatchController;ownerId?:string;editable:boolean;onBlocked:(blocked:boolean)=>void}) {
  const {uploads,select,selectMany,retry,remove,deletePhoto,deleting,error}=useRepairPhotos(controller,onBlocked);
  const photos=controller.detail!.files.filter(f=>f.kind==='repair_progress_photo');
  const currentPhotos=photos.filter(f=>(!ownerId||f.uploadedBy===ownerId)&&(f.repairRound||0)===(controller.detail!.task.repairRound||0));
  return <section className="repair-photos" aria-label="维修照片">
    <h3>维修照片 <span>（必填）</span></h3>
    {editable?<p className="dispatch-muted">提交完工前，须上传至少一张本轮维修照片。支持相册多选，上传后自动保存；本轮照片可删除。</p>:null}
    {editable?<ImageSourcePicker label="维修记录" primaryActionLabel="拍照记录" galleryActionLabel="相册" loading={uploads.some(p=>p.state==='uploading')} disabled={controller.busy || deleting} multiple onSelectMany={selectMany} onSelect={select}/>:null}
    {error?<Alert type="error" showIcon title={error}/>:null}
    <Image.PreviewGroup><div className="repair-photo-grid">{photos.map(photo=><div key={photo.id}>
      <AuthenticatedImage fileId={photo.id} alt="维修过程照片" width="100%" height={100}/>
      <small>{photo.repairRound?`返工第 ${photo.repairRound} 轮`:'原维修'} · 已保存 · {photo.uploadedName||'维修人员'}<br/>{displayTime(photo.createdAt)}</small>
      {editable && (!ownerId||photo.uploadedBy===ownerId) && (photo.repairRound||0)===(controller.detail!.task.repairRound||0)?<Popconfirm title="删除这张维修照片？" description="提交完工时须保留至少一张本轮照片。" okText="删除" cancelText="取消" onConfirm={()=>deletePhoto(photo.id)}><Button danger size="small" disabled={controller.busy||deleting||uploads.length>0}>删除照片</Button></Popconfirm>:null}
    </div>)}</div></Image.PreviewGroup>
    {uploads.map(row=><div key={row.id} className="repair-photo-upload" role="status">{row.state==='uploading'?<span>照片上传中…</span>:<><Alert type="error" showIcon title="照片上传失败" description={row.error}/><Button onClick={()=>void retry(row)} disabled={!editable}>重试</Button><Button onClick={()=>remove(row.id)}>移除失败照片</Button></>}</div>)}
    {editable&&!currentPhotos.length?<p role="status">本轮尚未上传维修照片</p>:null}
    {!editable&&!photos.length&&!uploads.length?<p className="dispatch-muted">暂无维修照片</p>:null}
  </section>;
}
