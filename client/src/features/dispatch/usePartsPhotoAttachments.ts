import {useEffect,useRef,useState} from 'react';
import {prepareUploadPhoto} from '../../shared/images/prepareOcrImage';
import {createRequestId} from '../../shared/api/requestId';
import {dispatchApi} from './dispatchApi';
import type {DispatchController} from './useDispatchController';

type Upload={id:string;file:File;replaceId?:string;state:'uploading'|'failed';error?:string;body?:Awaited<ReturnType<typeof prepareUploadPhoto>>};
export function usePartsPhotoAttachments(c:DispatchController,ids:string[],onChange:(ids:string[])=>void){
 const [uploads,setUploads]=useState<Upload[]>([]),[error,setError]=useState('');
 const pending=useRef<Upload[]>([]),currentIds=useRef(ids),mounted=useRef(true),running=useRef(false);
 currentIds.current=ids;
 const task=c.detail!.task;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 function update(rows:Upload[]){pending.current=rows;if(mounted.current)setUploads(rows);}
 function applyIds(next:string[]){currentIds.current=next;if(mounted.current)onChange(next);}
 async function send(row:Upload){
  update(pending.current.map(item=>item.id===row.id?{...row,state:'uploading',error:undefined}:item));
  try{
   row.body ||= await prepareUploadPhoto(row.file);
   const photo=await dispatchApi.uploadPhoto(task.orderId,{...row.body,requestId:row.id,repairRound:task.repairRound||0,purpose:'parts'});
   const next=row.replaceId?currentIds.current.map(id=>id===row.replaceId?photo.id:id):[...new Set([...currentIds.current,photo.id])];
   applyIds(next);
   update(pending.current.filter(item=>item.id!==row.id));
   try{await c.refreshDetail();}catch{if(mounted.current)setError('照片已上传，刷新失败，请稍后重新打开申请核对。');}
  }catch(reason){update(pending.current.map(item=>item.id===row.id?{...row,state:'failed',error:reason instanceof Error?reason.message:'照片上传失败'}:item));}
 }
 async function upload(files:File[],replaceId?:string){
  if(running.current)return false;
  setError('');
  const count=currentIds.current.length+pending.current.filter(row=>!row.replaceId).length+(replaceId?0:files.length);
  if(!files.length||replaceId&&(!currentIds.current.includes(replaceId)||files.length!==1)||count>10){setError('配件照片最多 10 张，请减少选择或先删除照片。');return false;}
  running.current=true;
  const rows:Upload[]=files.map(file=>({id:createRequestId(),file,replaceId,state:'uploading'}));
  update([...pending.current,...rows]);
  try{for(const row of rows)await send(row);}finally{running.current=false;}
 }
 async function retry(row:Upload){if(running.current)return;running.current=true;try{await send(row);}finally{running.current=false;}}
 return {uploads,error,upload,retry,uploading:uploads.some(row=>row.state==='uploading'),removeFailed:(id:string)=>update(pending.current.filter(row=>row.id!==id)),remove:async(removed:string[])=>{if(running.current)return false;applyIds(currentIds.current.filter(id=>!removed.includes(id)));return true;}};
}
