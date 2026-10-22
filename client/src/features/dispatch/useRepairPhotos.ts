import { useEffect, useRef, useState } from 'react';
import { prepareUploadPhoto } from '../../shared/images/prepareOcrImage';
import { createRequestId } from '../../shared/api/requestId';
import { dispatchApi } from './dispatchApi';
import type { DispatchController } from './useDispatchController';
type Upload = { repairRound:number; id:string; file:File; state:'uploading'|'failed'; error?:string; body?:Awaited<ReturnType<typeof prepareUploadPhoto>> };
export function useRepairPhotos(controller:DispatchController,onBlocked:(blocked:boolean)=>void) {
  const [deleting,setDeleting]=useState(false),[error,setError]=useState('');
  const [uploads,setUploads]=useState<Upload[]>([]);
  const pending=useRef<Upload[]>([]),mounted=useRef(true),deletingRef=useRef(false),generation=useRef(0);
  const orderId=controller.detail!.task.orderId;
  function update(next:Upload[]) {pending.current=next;if(mounted.current)setUploads(next);}
  useEffect(()=>{onBlocked(uploads.length>0 || deleting);},[uploads,deleting,onBlocked]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;onBlocked(false);};},[onBlocked]);
  async function upload(row:Upload) {
    update(pending.current.map(p=>p.id===row.id?{...p,state:'uploading',error:undefined}:p));
    try {
      row.body ||= await prepareUploadPhoto(row.file);
      await dispatchApi.uploadPhoto(orderId,{...row.body,requestId:row.id,repairRound:row.repairRound});
      await controller.refreshDetail();
      update(pending.current.filter(p=>p.id!==row.id));
    } catch(error) {update(pending.current.map(p=>p.id===row.id?{...row,state:'failed',error:error instanceof Error?error.message:'上传失败'}:p));}
  }
  async function select(file:File) {const row:Upload={repairRound:controller.detail!.task.repairRound||0,id:createRequestId(),file,state:'uploading'};update([...pending.current,row]);await upload(row);}
  async function selectMany(files:File[]) {
    const rows:Upload[]=files.map(file=>({repairRound:controller.detail!.task.repairRound||0,id:createRequestId(),file,state:'uploading'}));
    update([...pending.current,...rows]);
    for(const row of rows) await upload(row);
  }
  async function deletePhotos(ids:string[]):Promise<boolean> {
    if (!ids.length || controller.busy || deletingRef.current || pending.current.length) return false;
    const session=generation.current;
    deletingRef.current=true;setDeleting(true);setError('');
    try {
      await dispatchApi.deletePhotos(orderId,{fileIds:ids});
      if(!mounted.current || session!==generation.current)return false;
      await controller.refreshDetail();
      return mounted.current && session===generation.current;
    } catch(reason) {
      if(mounted.current && session===generation.current)setError(reason instanceof Error?reason.message:'删除失败，请重试');
      return false;
    } finally {
      deletingRef.current=false;
      if(mounted.current && session===generation.current)setDeleting(false);
    }
  }

  return {uploads,select,selectMany,deletePhotos,deletePhoto:(id:string)=>deletePhotos([id]),deleting,error,retry:upload,remove:(id:string)=>update(pending.current.filter(p=>p.id!==id))};
}
