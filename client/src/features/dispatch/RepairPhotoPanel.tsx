import { useEffect, useState } from 'react';
import { Button, Image, Alert, Checkbox, Modal, Radio } from 'antd';
import { Trash2 } from 'lucide-react';
import { ImageSourcePicker } from '../../shared/ui/ImageSourcePicker';
import { AuthenticatedImage } from '../../shared/ui/AuthenticatedImage';
import { usePhotoSelection } from '../../shared/ui/PhotoBatchActions';
import { useRepairPhotos } from './useRepairPhotos';
import { displayTime } from './dispatchLabels';
import type { DispatchController } from './useDispatchController';

export function RepairPhotoPanel({controller,editable,onBlocked,ownerId}:{controller:DispatchController;ownerId?:string;editable:boolean;onBlocked:(blocked:boolean)=>void}) {
  const [purpose,setPurpose]=useState<"progress"|"completed">("progress");
  const {uploads,select,selectMany,retry,remove,deletePhotos,deleting,error}=useRepairPhotos(controller,onBlocked,purpose);
  const [managing,setManaging]=useState(false);
  const [confirmIds,setConfirmIds]=useState<string[]>();
  const task=controller.detail!.task;
  const photos=controller.detail!.files.filter(f=>['repair_progress_photo','repair_completed_photo'].includes(f.kind));
  const currentPhotos=photos.filter(f=>(!ownerId||f.uploadedBy===ownerId)&&(f.repairRound||0)===(task.repairRound||0));
  const eligibleIds=editable?currentPhotos.map(photo=>photo.id):[];
  const selection=usePhotoSelection(eligibleIds);
  const busy=controller.busy||deleting||uploads.length>0;
  useEffect(()=>{setManaging(false);setConfirmIds(undefined);selection.clear();},[task.orderId,task.repairRound,ownerId,editable]);
  useEffect(()=>{if(!currentPhotos.length){setManaging(false);selection.clear();}},[currentPhotos.length]);
  async function confirmDelete() {
    if(busy||!confirmIds||!editable||confirmIds.some(id=>!eligibleIds.includes(id)))return;
    if(await deletePhotos(confirmIds)){selection.clear();setConfirmIds(undefined);}
  }
  return <section className="repair-photos" aria-label="维修照片">
    <div className="repair-photo-heading"><h3>维修照片 <span>（必填）</span></h3>
      {editable&&currentPhotos.length>0&&<Button icon={managing?undefined:<Trash2 size={16}/>} disabled={busy} onClick={()=>{setManaging(!managing);selection.clear();}}>{managing?'完成':'多选删除'}</Button>}
    </div>
    {editable?<p className="dispatch-muted">提交完工前，须上传至少一张本轮维修照片。支持相册多选，上传后自动保存；本轮照片可多选删除。</p>:null}
    {editable&&!managing&&<Radio.Group aria-label="维修照片分类" value={purpose} disabled={busy} onChange={event=>setPurpose(event.target.value)} options={[{label:"维修时",value:"progress"},{label:"维修完成",value:"completed"}]} style={{marginBottom:12}}/>}
    {editable&&!managing?<ImageSourcePicker label="维修记录" primaryActionLabel="拍照记录" galleryActionLabel="相册" loading={uploads.some(p=>p.state==='uploading')} disabled={controller.busy || deleting} multiple onSelectMany={selectMany} onSelect={select}/>:null}
    {error&&!confirmIds?<Alert type="error" showIcon title={error}/>:null}
    {managing&&editable&&<div className="repair-photo-batch">
      <Checkbox disabled={busy} checked={Boolean(eligibleIds.length&&selection.selectedIds.length===eligibleIds.length)} indeterminate={Boolean(selection.selectedIds.length&&selection.selectedIds.length<eligibleIds.length)} onChange={event=>selection.selectAll(event.target.checked)}>全选本轮照片</Checkbox>
      <span>已选 {selection.selectedIds.length} 张</span>
      <Button danger disabled={busy||!selection.selectedIds.length} onClick={()=>setConfirmIds([...selection.selectedIds])}>删除所选</Button>
    </div>}
    <Image.PreviewGroup><div className="repair-photo-grid">{photos.map(photo=><div key={photo.id} className={selection.selectedIds.includes(photo.id)?'repair-photo-card is-selected':'repair-photo-card'}>
      <div className="repair-photo-thumbnail"><AuthenticatedImage fileId={photo.id} alt="维修过程照片" width="100%" height={100}/>
        {managing&&eligibleIds.includes(photo.id)&&<Checkbox className="repair-photo-check" aria-label={`选择维修照片 ${photo.originalName||photo.id}`} disabled={busy} checked={selection.selectedIds.includes(photo.id)} onChange={event=>selection.toggle(photo.id,event.target.checked)}/>}
      </div>
      <small>{photo.kind==='repair_completed_photo'?'维修完成':'维修时'} · {photo.repairRound?`返工第 ${photo.repairRound} 轮`:'原维修'} · 已保存 · {photo.uploadedName||'维修人员'}<br/>{displayTime(photo.createdAt)}</small>
      {editable&&!managing&&eligibleIds.includes(photo.id)?<Button danger size="small" disabled={busy} onClick={()=>setConfirmIds([photo.id])}>删除照片</Button>:null}
    </div>)}</div></Image.PreviewGroup>
    {uploads.map(row=><div key={row.id} className="repair-photo-upload" role="status">{row.state==='uploading'?<span>照片上传中…</span>:<><Alert type="error" showIcon title="照片上传失败" description={row.error}/><Button onClick={()=>void retry(row)} disabled={!editable}>重试</Button><Button onClick={()=>remove(row.id)}>移除失败照片</Button></>}</div>)}
    {editable&&!currentPhotos.length?<p role="status">本轮尚未上传维修照片</p>:null}
    {!editable&&!photos.length&&!uploads.length?<p className="dispatch-muted">暂无维修照片</p>:null}
    <Modal title={`删除选中的 ${confirmIds?.length||0} 张维修照片？`} open={Boolean(confirmIds)} okText="删除照片" cancelText="取消" okButtonProps={{danger:true,disabled:controller.busy||uploads.length>0||!editable||!confirmIds?.length||confirmIds.some(id=>!eligibleIds.includes(id))}} confirmLoading={deleting}
      onOk={()=>void confirmDelete()} onCancel={()=>{if(!deleting)setConfirmIds(undefined);}} cancelButtonProps={{disabled:deleting}} closable={!deleting} mask={{closable:!deleting}} zIndex={1500}>
      <p>仅删除所选的本轮维修照片。提交完工时须保留至少一张本轮照片。</p>
      {error&&<Alert type="error" showIcon title={error}/>}
    </Modal>
  </section>;
}
