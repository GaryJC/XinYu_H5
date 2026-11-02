import {useEffect,useRef,useState} from 'react';
import type {DispatchController} from './useDispatchController';
import {prepareUploadPhoto} from '../../shared/images/prepareOcrImage';
import {createRequestId} from '../../shared/api/requestId';
import {dispatchApi} from './dispatchApi';

export function useVehicleNameplateUpload(c:DispatchController,enabled=true) {
 const task=c.detail!.task,orderId=task.orderId,round=task.repairRound||0;
 const hasNameplate=c.detail!.files.some(file=>file.kind==='vehicle_nameplate_photo');
 const [uploading,setUploading]=useState(false),[checking,setChecking]=useState(false),[error,setError]=useState('');
 const [initializing,setInitializing]=useState(enabled&&!hasNameplate),[historyError,setHistoryError]=useState('');
 const [historyRevision,setHistoryRevision]=useState(0);
 const running=useRef(false);
 const pending=useRef<Promise<{id:string|null}>|undefined>(undefined);
 useEffect(()=>{
  let active=true;
  setHistoryError('');setInitializing(enabled&&!hasNameplate);
  if(enabled&&!hasNameplate) {
   const request=dispatchApi.ensureNameplate(orderId,{requestId:createRequestId(),repairRound:round});
   pending.current=request;
   void request.then(async result=>{if(active&&result.id)await c.refreshDetail();}).catch(reason=>{
    if(active)setHistoryError(reason instanceof Error?reason.message:'历史铭牌加载失败，请重试');
   }).finally(()=>{if(pending.current===request)pending.current=undefined;if(active)setInitializing(false);});
  }
  return()=>{active=false;};
 },[orderId,round,task.vehicleVin,task.plate,hasNameplate,enabled,historyRevision]);
 async function upload(file:File) {
  if(running.current||initializing||c.busy||!enabled)return;
  running.current=true;setUploading(true);setError('');
  try {
   const body=await prepareUploadPhoto(file);
   await dispatchApi.uploadPhoto(orderId,{...body,requestId:createRequestId(),repairRound:round,purpose:'nameplate'});
   await c.refreshDetail();
  } catch(reason) {setError(reason instanceof Error?reason.message:'铭牌照片上传失败，请重试');}
  finally {running.current=false;setUploading(false);}
 }
 async function check() {
  setChecking(true);
  try {
   if(enabled)await (pending.current||dispatchApi.ensureNameplate(orderId,{requestId:createRequestId(),repairRound:round}));
   const detail=await dispatchApi.detail(orderId);
   const exists=detail.files.some(file=>file.kind==='vehicle_nameplate_photo');
   if(exists)await c.refreshDetail();
   return exists;
  } finally {setChecking(false);}
 }
 return {upload,uploading:uploading||initializing,error,check,checking,historyLoading:initializing,historyError,reloadHistory:()=>setHistoryRevision(value=>value+1)};
}
