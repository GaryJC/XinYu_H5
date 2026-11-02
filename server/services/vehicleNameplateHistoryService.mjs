import {transaction} from '../database/pool.mjs';
import {HttpError} from '../http/HttpError.mjs';
import {getDispatchTask} from '../repositories/dispatchRepository.mjs';
import {findVehicleNameplateHistory,copyVehicleNameplate} from '../repositories/vehicleNameplateHistoryRepository.mjs';
import {recordVehicleNameplate} from '../repositories/vehicleNameplateRepository.mjs';
import {hasAnyRole} from '../../shared/roles.mjs';
import {technicianIds} from '../domain/dispatchPolicy.mjs';
import {hasSubmittedPersonalWork} from '../domain/individualRepair.mjs';

// Explicit POST from the repair workflow: never change an order as a side effect of a GET.
export async function ensureVehicleNameplate(actor,id,body,{runTransaction=transaction}={}) {
  if(!body||!/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId||'')||!Number.isInteger(body.repairRound)||body.repairRound<0)throw new HttpError(400,'铭牌参数无效');
  return runTransaction(async client=>{
    const task=await getDispatchTask(client,id,actor,true);
    const {rows:users}=await client.query('select role,active,shop_id from users where id=$1',[actor.id]);
    const owner=task.executionMode==='outsourced'?(hasAnyRole(actor,['manager','advisor'])||actor.id===task.assignedBy&&hasAnyRole(actor,['inspector'])):hasAnyRole(actor,['technician'])&&technicianIds(task).includes(actor.id);
    if(!users[0]?.active||users[0].role!==actor.role||users[0].shop_id!==task.shopId||!owner||task.needsReview)throw new HttpError(403,'仅当前维修工可沿用历史铭牌');
    if(body.repairRound!==(task.repairRound||0))throw new HttpError(409,'维修轮次已变化，请刷新后重试');
    if(!['待接单','待开工','维修中','暂停','回审'].includes(task.stage)||task.stage==='待接单'&&task.feedback||hasSubmittedPersonalWork(task,actor.id))throw new HttpError(409,'当前状态不能更换铭牌照片');
    const {rows:current}=await client.query("select id from files where order_id=$1 and kind='vehicle_nameplate_photo' order by (id=$2) desc,created_at desc,id desc limit 1",[id,task.vehicleNameplateFileId||'']);
    if(current[0])return {id:current[0].id};
    const source=await findVehicleNameplateHistory(client,task);
    if(!source)return {id:null};
    const file=await copyVehicleNameplate(client,source,task,actor,body.requestId);
    await recordVehicleNameplate(client,task,actor,file.id,body.requestId,source.id);
    return file;
  });
}
