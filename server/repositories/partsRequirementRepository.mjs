import { HttpError } from '../http/HttpError.mjs';
export async function assertPartsPhotos(client,task,requirement) {
  if(requirement.mode!=='photo') return;
  const {rows}=await client.query("select id from files where id=any($1::text[]) and order_id=$2 and repair_round=$3 and kind='repair_parts_photo'",[requirement.photoIds,task.orderId,task.repairRound||0]);
  if(rows.length!==requirement.photoIds.length) throw new HttpError(400,'配件照片必须是本单当前维修轮次已上传的手写清单');
}
