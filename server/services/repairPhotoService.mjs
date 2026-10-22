import { hasAnyRole } from "../../shared/roles.mjs";
import { removeRepairPhoto } from '../repositories/repairPhotoRepository.mjs';
import { transaction } from '../database/pool.mjs';
import { getDispatchTask } from '../repositories/dispatchRepository.mjs';
import { technicianIds } from '../domain/dispatchPolicy.mjs';
import { HttpError } from '../http/HttpError.mjs';
import { saveUploadedFile } from '../storage.mjs';
export function validateRepairPhoto(body) {
  if(!body || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId||'') || typeof body.imageBase64!=='string') throw new HttpError(400,'照片参数无效');
  if(body.repairRound!==undefined && (!Number.isInteger(body.repairRound)||body.repairRound<0)) throw new HttpError(400,'维修轮次无效');
  if(body.purpose!==undefined&&!['progress','parts'].includes(body.purpose)) throw new HttpError(400,'照片用途无效');
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
    const owner=(hasAnyRole(actor, ['technician','outsourcing'])||actor.outsourcingRoleMember)&&technicianIds(task).includes(actor.id)||task.executionMode==='outsourced'&&hasAnyRole(actor, ['manager','advisor']);
    if(!users[0]?.active || users[0].role!==actor.role || users[0].shop_id!==task.shopId || !owner || task.needsReview) throw new HttpError(403,'仅当前维修工可上传维修照片');
    const kind=body.purpose==='parts'?'repair_parts_photo':'repair_progress_photo';
    const {rows}=await client.query('select id,kind,repair_round from files where order_id=$1 and uploaded_by=$2 and upload_request_id=$3',[id,actor.id,body.requestId]);
    if(rows[0]) {if(rows[0].kind!==kind)throw new HttpError(409,'该上传编号已用于其他照片');if((rows[0].repair_round||0)!==(task.repairRound||0)) throw new HttpError(409,'照片属于之前的维修轮次，请重新选择照片');return rows[0];}
    if((body.repairRound||0)!==(task.repairRound||0)) throw new HttpError(409,'维修轮次已变化，请刷新后重新上传');
    if(!(body.purpose==='parts'?['待接单','待开工','维修中','暂停']:["待开工","维修中","暂停","回审"]).includes(task.stage)||task.stage==='待接单'&&task.feedback) throw new HttpError(409,'当前状态不能上传维修照片');
    const file=await save({orderId:id,kind,fileName:body.fileName,mimeType:body.mimeType,imageBase64:body.imageBase64,uploadedBy:actor.id,uploadRequestId:body.requestId,database:client});
    await client.query('update files set repair_round=$2 where id=$1',[file.id,task.repairRound||0]);
    return {...file,repairRound:task.repairRound||0};
  });
}

export async function deleteRepairPhoto(actor, orderId, fileId) {
  return transaction(client => removeRepairPhoto(client, actor, orderId, fileId));
}
