import {VehicleNameplateIllustration} from '../../shared/ui/VehicleNameplateIllustration';
import {useState} from 'react';
import {Alert,Button,Popover} from 'antd';
import {ReloadOutlined} from '@ant-design/icons';
import './vehicle-nameplate.css';
export {useVehicleNameplateUpload} from './useVehicleNameplateUpload';
import type {DispatchDetail} from '../../../../shared/types';
import {AuthenticatedImage} from '../../shared/ui/AuthenticatedImage';
import {ImageSourcePicker} from '../../shared/ui/ImageSourcePicker';

export function VehicleNameplatePhotos({files,currentId,onUpload,disabled=false,uploading=false,error,historyLoading,historyError,onReloadHistory}:{historyLoading?:boolean;historyError?:string;onReloadHistory?:()=>void;currentId?:string;files:DispatchDetail['files'];onUpload?:(file:File)=>Promise<void>;disabled?:boolean;uploading?:boolean;error?:string}) {
 const [replacing,setReplacing]=useState(false);
 const candidates=files.filter(file=>file.kind==='vehicle_nameplate_photo');
 const current=candidates.find(file=>file.id===currentId)||candidates.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))[0];
 const picker=onUpload?<ImageSourcePicker emphasized={!current} cameraArtwork={current?undefined:<VehicleNameplateIllustration/>} loadingLabel="正在处理…" label="车辆铭牌照片" primaryActionLabel={current?'重新拍摄':'拍摄车辆铭牌'} galleryActionLabel="相册选择" disabled={disabled||uploading} loading={uploading} onSelect={async file=>{setReplacing(false);await onUpload(file);}}/>:null;
 return <section aria-label="车辆铭牌照片" className="vehicle-nameplate">
  <div className="vehicle-nameplate-heading"><h3>车辆铭牌照片</h3>
   {current&&onUpload?<Popover trigger="click" placement="bottomRight" open={replacing&&!disabled&&!uploading} onOpenChange={setReplacing} content={picker}>
    <Button icon={<ReloadOutlined/>} disabled={disabled||uploading} loading={uploading}>重新上传</Button>
   </Popover>:null}
  </div>
  <p>{current?(current.nameplateSourceFileId?'已沿用历史铭牌，全单维修工共用。':'已上传，全单维修工共用。'):'请拍清车辆型号、发动机型号和 VIN，供仓管核对配件。'}</p>
  {!current&&onUpload&&historyLoading?<p role="status">正在加载这辆车的铭牌…</p>:null}
  {!current&&onUpload&&historyError?<Alert type="warning" showIcon title="历史铭牌暂时无法加载" description="可重试查询，或直接拍摄新照片。" action={<Button disabled={disabled||uploading} onClick={onReloadHistory}>重试查询</Button>}/>:null}
  {current?<div className="vehicle-nameplate-preview"><AuthenticatedImage key={current.id} fileId={current.id} alt="车辆铭牌照片" width="100%" height={200}/></div>:picker||<p>尚未上传车辆铭牌照片</p>}
  {current&&onUpload?<p className="dispatch-muted">重新上传会替换该车保存的铭牌，后续维修自动沿用新照片，并通知仓管。</p>:null}
  {error?<Alert type="error" showIcon title={error}/>:null}
 </section>;
}
