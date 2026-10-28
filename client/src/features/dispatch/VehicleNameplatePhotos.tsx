import {VehicleNameplateIllustration} from './VehicleNameplateIllustration';
import {useRef,useState} from 'react';
import {Alert,Button,Popover} from 'antd';
import {ReloadOutlined} from '@ant-design/icons';
import './vehicle-nameplate.css';
import type {DispatchDetail} from '../../../../shared/types';
import type {DispatchController} from './useDispatchController';
import {AuthenticatedImage} from '../../shared/ui/AuthenticatedImage';
import {ImageSourcePicker} from '../../shared/ui/ImageSourcePicker';
import {prepareUploadPhoto} from '../../shared/images/prepareOcrImage';
import {createRequestId} from '../../shared/api/requestId';
import {dispatchApi} from './dispatchApi';

export function useVehicleNameplateUpload(c:DispatchController) {
 const [uploading,setUploading]=useState(false),[checking,setChecking]=useState(false),[error,setError]=useState('');
 const running=useRef(false);
 async function upload(file:File) {
  if(running.current)return;
  running.current=true;setUploading(true);setError('');
  try {
   const body=await prepareUploadPhoto(file);
   await dispatchApi.uploadPhoto(c.detail!.task.orderId,{...body,requestId:createRequestId(),repairRound:c.detail!.task.repairRound||0,purpose:'nameplate'});
   await c.refreshDetail();
  } catch(reason) {setError(reason instanceof Error?reason.message:'铭牌照片上传失败，请重试');}
  finally {running.current=false;setUploading(false);}
 }
 async function check() {
  setChecking(true);
  try {
   const detail=await dispatchApi.detail(c.detail!.task.orderId);
   const exists=detail.files.some(file=>file.kind==='vehicle_nameplate_photo');
   if(exists)await c.refreshDetail();
   return exists;
  } finally {setChecking(false);}
 }
 return {upload,uploading,error,check,checking};
}

export function VehicleNameplatePhotos({files,currentId,onUpload,disabled=false,uploading=false,error}:{currentId?:string;files:DispatchDetail['files'];onUpload?:(file:File)=>Promise<void>;disabled?:boolean;uploading?:boolean;error?:string}) {
 const [replacing,setReplacing]=useState(false);
 const candidates=files.filter(file=>file.kind==='vehicle_nameplate_photo');
 const current=candidates.find(file=>file.id===currentId)||candidates.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))[0];
 const picker=onUpload?<ImageSourcePicker emphasized={!current} cameraArtwork={current?undefined:<VehicleNameplateIllustration/>} loadingLabel="正在上传…" label="车辆铭牌照片" primaryActionLabel={current?'重新拍摄':'拍摄车辆铭牌'} galleryActionLabel="相册选择" disabled={disabled||uploading} loading={uploading} onSelect={async file=>{setReplacing(false);await onUpload(file);}}/>:null;
 return <section aria-label="车辆铭牌照片" className="vehicle-nameplate">
  <div className="vehicle-nameplate-heading"><h3>车辆铭牌照片</h3>
   {current&&onUpload?<Popover trigger="click" placement="bottomRight" open={replacing&&!disabled&&!uploading} onOpenChange={setReplacing} content={picker}>
    <Button icon={<ReloadOutlined/>} disabled={disabled||uploading} loading={uploading}>重新上传</Button>
   </Popover>:null}
  </div>
  <p>{current?'已上传，全单维修工共用。点击照片可查看原图。':'请拍清车辆型号、发动机型号和 VIN，供仓管核对配件。'}</p>
  {current?<div className="vehicle-nameplate-preview"><AuthenticatedImage key={current.id} fileId={current.id} alt="车辆铭牌照片" width="100%" height={200}/></div>:picker||<p>尚未上传车辆铭牌照片</p>}
  {current&&onUpload?<p className="dispatch-muted">重新上传后立即更新，并通知仓管。</p>:null}
  {error?<Alert type="error" showIcon title={error}/>:null}
 </section>;
}
