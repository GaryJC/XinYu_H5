import { transaction } from '../database/pool.mjs';
import { getDispatchTask } from '../repositories/dispatchRepository.mjs';
import { technicianIds } from '../domain/dispatchPolicy.mjs';
import { HttpError } from '../http/HttpError.mjs';
import { saveUploadedFile } from '../storage.mjs';
export function validateRepairPhoto(body) {
  if(!body || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId||'') || typeof body.imageBase64!=='string') throw new HttpError(400,'照片参数无效');
  const encoded=body.imageBase64.replace(/^data:[^;]+;base64,/, '');
  if(!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length>12*1024*1024) throw new HttpError(413,'照片内容无效或过大');
  const data=Buffer.from(encoded,'base64');
  if(body.fileName!==undefined && (typeof body.fileName!=='string' || body.fileName.length>255)) throw new HttpError(400,'照片文件名无效');
  const valid=body.mimeType==='image/jpeg' && data.length>=4 && data[0]===255 && data[1]===216 && data[2]===255
    || body.mimeType==='image/png' && data.length>=33 && data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    || body.mimeType==='image/webp' && data.length>=20 && data.subarray(0,4).toString()==='RIFF' && data.subarray(8,12).toString()==='WEBP';
  if(!valid || !data.length || data.length>8*1024*1024) throw new HttpError(400,'请上传不超过 8MB 的 JPG、PNG 或 WebP 图片');
}
export async function uploadRepairPhoto(actor,id,body,{runTransaction=transaction,save=saveUploadedFile}={}) {
  validateRepairPhoto(body);
  return runTransaction(async client=> {
    const task=await getDispatchTask(client,id,actor,true);
    const {rows:users}=await client.query('select role,active,shop_id from users where id=$1',[actor.id]);
    if(!users[0]?.active || users[0].role!=='technician' || users[0].shop_id!==task.shopId || actor.role!=='technician' || !technicianIds(task).includes(actor.id) || task.needsReview) throw new HttpError(403,'仅当前维修工可上传维修照片');
    const {rows}=await client.query('select id from files where order_id=$1 and uploaded_by=$2 and upload_request_id=$3',[id,actor.id,body.requestId]);
    if(rows[0]) return rows[0];
    if(!['待开工','维修中','暂停'].includes(task.stage)) throw new HttpError(409,'当前状态不能上传维修照片');
    return save({orderId:id,kind:'repair_progress_photo',fileName:body.fileName,mimeType:body.mimeType,imageBase64:body.imageBase64,uploadedBy:actor.id,uploadRequestId:body.requestId,database:client});
  });
}
