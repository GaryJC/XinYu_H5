import {ProcurementPhoto} from './ProcurementPhoto';
export {ProcurementPhoto} from './ProcurementPhoto';
import { createRequestId } from "../../shared/api/requestId";
import {useState,useRef} from 'react';
import {Alert,Button,Space} from 'antd';
import {ImageSourcePicker} from '../../shared/ui/ImageSourcePicker';
import {prepareUploadPhoto} from '../../shared/images/prepareOcrImage';
import {VehicleNameplateIllustration} from '../../shared/ui/VehicleNameplateIllustration';
import {procurementApi} from './procurementApi';
export function ProcurementNameplatePhotos({value=[],onChange,onBusy,disabled,other=false}:{value?:string[];onChange?:(ids:string[])=>void;onBusy:(busy:boolean)=>void;disabled:boolean;other?:boolean}) {
 const limit=other?10:1;
 const label=other?"其他照片":"铭牌号照片";
 const running=useRef(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function run(work:()=>Promise<void>){if(running.current)return;running.current=true;setBusy(true);onBusy(true);setError('');try{await work();}catch(e){setError(e instanceof Error?e.message:'操作失败，请重试');}finally{running.current=false;setBusy(false);onBusy(false);}}
 async function upload(files:File[]){
  await run(async()=>{
   if(other&&value.length+files.length>limit)throw new Error('其他照片最多上传10张，请重新选择');
   let ids=other?[...value]:[];
   for(const file of files.slice(0,other?limit:1)){
    const body=await prepareUploadPhoto(file);
    const saved=await procurementApi.uploadPhoto({...body,requestId:createRequestId()});
    ids=[...ids,saved.id];onChange?.(ids);
   }
  });
 }
 return <div>
  <p className="procurement-muted">{other?'可上传配件细节等补充照片，供供应商核对，最多10张。':'上传车辆铭牌，供供应商核对。请拍清型号（Model）和车架号。'}</p>
  <Space wrap>{value.map(id=><div key={id}><ProcurementPhoto id={id} label={label}/><div><Button size="small" danger disabled={busy||disabled} onClick={()=>onChange?.(value.filter(v=>v!==id))}>移除</Button></div></div>)}</Space>
  {(!other||value.length<limit)?<ImageSourcePicker label={label}
    emphasized={!other&&!value.length} cameraArtwork={!other&&!value.length?<VehicleNameplateIllustration/>:undefined}
    primaryActionLabel={other?'拍摄其他照片':value.length?'重新拍摄铭牌':'拍摄车辆铭牌'}
    galleryActionLabel={value.length&&!other?'从相册更换':'相册选择'} loadingLabel="正在上传…"
    loading={busy} disabled={disabled||busy} multiple={other}
    onSelectMany={other?upload:undefined} onSelect={file=>upload([file])}/>:null}
  {error?<Alert type="error" showIcon title={error}/>:null}
 </div>;
}
