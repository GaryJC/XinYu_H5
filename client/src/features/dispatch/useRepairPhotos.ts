import { useEffect, useRef, useState } from 'react';
import { prepareOcrImage } from '../../shared/images/prepareOcrImage';
import { createRequestId } from '../../shared/api/requestId';
import { dispatchApi } from './dispatchApi';
import type { DispatchController } from './useDispatchController';
type Upload = { repairRound:number; id:string; file:File; state:'uploading'|'failed'; error?:string; body?:Awaited<ReturnType<typeof prepareOcrImage>> };
export function useRepairPhotos(controller:DispatchController,onBlocked:(blocked:boolean)=>void) {
  const [uploads,setUploads]=useState<Upload[]>([]);
  const pending=useRef<Upload[]>([]),mounted=useRef(true);
  const orderId=controller.detail!.task.orderId;
  function update(next:Upload[]) {pending.current=next;if(mounted.current)setUploads(next);}
  useEffect(()=>{onBlocked(uploads.length>0);},[uploads,onBlocked]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;onBlocked(false);};},[onBlocked]);
  async function upload(row:Upload) {
    update(pending.current.map(p=>p.id===row.id?{...p,state:'uploading',error:undefined}:p));
    try {
      row.body ||= await prepareOcrImage(row.file);
      await dispatchApi.uploadPhoto(orderId,{...row.body,requestId:row.id,repairRound:row.repairRound});
      await controller.refreshDetail();
      update(pending.current.filter(p=>p.id!==row.id));
    } catch(error) {update(pending.current.map(p=>p.id===row.id?{...row,state:'failed',error:error instanceof Error?error.message:'上传失败'}:p));}
  }
  async function select(file:File) {const row:Upload={repairRound:controller.detail!.task.repairRound||0,id:createRequestId(),file,state:'uploading'};update([...pending.current,row]);await upload(row);}
  return {uploads,select,retry:upload,remove:(id:string)=>update(pending.current.filter(p=>p.id!==id))};
}
