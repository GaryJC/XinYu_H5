import {resolveFailedRepairWriteback,retryFailedRepairWriteback} from '../repositories/repairWritebackRepository.mjs';
import {transaction} from '../database/pool.mjs';
import {getDispatchTask} from '../repositories/dispatchRepository.mjs';
import {HttpError} from '../http/HttpError.mjs';
import {wakeRepairWriteback} from '../workers/repairWritebackWorker.mjs';
export async function retryRepairWriteback(actor,id) {
 if(actor.role!=='manager'||!actor.active)throw new HttpError(403,'仅管理员可重试润丰写回');
 await transaction(async client=>{
  await getDispatchTask(client,id,actor,true);
  await retryFailedRepairWriteback(client,id,actor.name);
 });
 wakeRepairWriteback();
 return {ok:true};
}

export async function resolveRepairWriteback(actor,id,input) {
 if(actor.role!=='manager'||!actor.active)throw new HttpError(403,'仅管理员可确认润丰人工登记');
 await transaction(async client=>{
  await getDispatchTask(client,id,actor,true);
  await resolveFailedRepairWriteback(client,id,actor,input);
 });
 wakeRepairWriteback();
 return {ok:true};
}
