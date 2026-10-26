import {useEffect,useRef,useState} from 'react';
import type {VehicleLicenseHistory} from '../../../../shared/types';
import {vehicleLicenseHistoryApi as api} from './vehicleLicenseHistoryApi';
export function useVehicleLicenseHistory({plate,vin,fileId,orderId,userId,enabled,onReuse}:{plate:string;vin:string;fileId?:string;orderId?:string;userId?:string;enabled:boolean;onReuse:(fileId:string,vin:string)=>void}) {
 const normalize=(value:string)=>value.replace(/\s/g,'').toUpperCase();
 const p=normalize(plate),v=normalize(vin);
 const key=enabled?JSON.stringify([userId,orderId,p,v,fileId]):'';
 const latest=useRef(key);latest.current=key;
 const handled=useRef(new Set<string>());
 const reusePending=useRef(false);
 const candidateScope=useRef('');
 const scope=JSON.stringify([userId,orderId,fileId]);
 const decisionKey=(matchedVin:string,currentFileId=fileId)=>JSON.stringify([userId,orderId,normalize(matchedVin),currentFileId]);
 const [candidate,setCandidate]=useState<VehicleLicenseHistory>();
 const [preview,setPreview]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{
  let active=true;setCandidate(current=>key&&candidateScope.current===scope&&current&&v===current.vin&&!handled.current.has(decisionKey(current.vin))?current:undefined);setError('');
  if(!p&&!v&&!fileId)handled.current.clear();
  if(!key||(!v&&!p)||(v&&!/^[A-Z0-9]{17}$/.test(v))||handled.current.has(decisionKey(v)))return;
  const timer=setTimeout(()=>{void api.lookup({plate:p,vin:v,excludeOrderId:orderId}).then(result=>{
   if(active&&result&&result.fileId!==fileId&&!handled.current.has(decisionKey(result.vin))){candidateScope.current=scope;setCandidate(current=>current?.fileId===result.fileId?current:result);}
  }).catch(e=>{if(active)setError(e instanceof Error?e.message:'历史行驶证查询失败');});},400);
  return()=>{active=false;clearTimeout(timer);};
 },[key,revision]);
 useEffect(()=>{
  setPreview('');
  if(!candidate)return;
  let active=true,url='';
  void api.preview(candidate.fileId,candidate.vin).then(blob=>{if(active){url=URL.createObjectURL(blob);setPreview(url);}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'照片预览失败');});
  return()=>{active=false;if(url)URL.revokeObjectURL(url);};
 },[candidate]);
 function keepCurrent(){if(candidate)handled.current.add(decisionKey(candidate.vin));setCandidate(undefined);setError('');}
 async function reuse(){
  if(!candidate||reusePending.current)return;
  const current=key;reusePending.current=true;setBusy(true);setError('');
  try{
   const copied=await api.reuse({fileId:candidate.fileId,vin:candidate.vin});
   if(latest.current!==current)return;
   handled.current.add(decisionKey(candidate.vin));
   handled.current.add(decisionKey(copied.vin,copied.fileId));
   onReuse(copied.fileId,copied.vin);setCandidate(undefined);
  }catch(e){if(latest.current===current)setError(e instanceof Error?e.message:'复用失败');}
  finally{reusePending.current=false;setBusy(false);}
 }
 return {candidate,preview,error,busy,hasCurrent:Boolean(fileId),reuse,keepCurrent,retry:()=>setRevision(value=>value+1)};
}
export type VehicleLicenseHistoryController=ReturnType<typeof useVehicleLicenseHistory>;
