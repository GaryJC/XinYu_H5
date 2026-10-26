import {pendingRepairScheduleBlock} from '../../shared/pendingRepairScheduling.mjs';
import { pool,transaction } from '../database/pool.mjs';
import { HttpError } from '../http/HttpError.mjs';
import { hasAnyRole } from '../../shared/roles.mjs';
import { readPendingRepairs,newPendingRepair,writePendingRepairs,listPendingFollowups,readPendingRequest,recordPendingRequest } from '../repositories/pendingRepairsRepository.mjs';
import { getDispatchTask } from '../repositories/dispatchRepository.mjs';
import { executeDispatchActionInTransaction } from './dispatchService.mjs';
import { wakeRepairWriteback } from '../workers/repairWritebackWorker.mjs';
function access(actor,row,write=false) {
 if(!actor?.active||actor.shopId!==row.shop_id||!hasAnyRole(actor,write?['manager','advisor']:['manager','advisor','technician','inspector','warehouse','outsourcing']))throw new HttpError(403,'无权处理待确认项目');
}
export async function pendingRepairList(actor,id) {const row=await readPendingRepairs(pool,id);access(actor,row);if(!hasAnyRole(actor,['manager','advisor','inspector']))await getDispatchTask(pool,id,actor);return {items:row.items,version:row.version};}
export async function pendingRepairFollowups(actor) {
 if(!actor?.active||!hasAnyRole(actor,['manager','advisor']))throw new HttpError(403,'无权查看待确认跟进');
 return listPendingFollowups(pool,actor.shopId);
}
export async function pendingRepairCommand(actor,id,input) {
 if(!input||!['add','approve','decline','schedule','approve-and-schedule'].includes(input.action)||!Number.isInteger(input.expectedVersion)||typeof input.requestId!=='string'||!/^[\w-]{8,100}$/.test(input.requestId))throw new HttpError(400,'待确认操作参数无效');
 const result=await transaction(async client=>{
  const row=await readPendingRepairs(client,id,true);access(actor,row,true);
  const previous=await readPendingRequest(client,id,actor.id,input.requestId);
  if(previous){const sort=v=>JSON.stringify(v,Object.keys(v).sort());if(sort(previous)!==sort(input))throw new HttpError(409,'请求编号已用于其他操作');return {items:row.items,version:row.version};}
  if(row.version!==input.expectedVersion)throw new HttpError(409,'待确认项目已更新，请刷新');
  const items=structuredClone(row.items);
  if(input.action==='add') {if(items.length>=100)throw new HttpError(400,'待确认项目最多 100 项');items.push(await newPendingRepair(client,input,actor));}
  else {
   const item=items.find(p=>p.id===input.id);if(!item)throw new HttpError(404,'待确认项目不存在');
   if(item.scheduled)throw new HttpError(409,'已安排维修的项目不可重复处理');
   const scheduling=['schedule','approve-and-schedule'].includes(input.action);
   const note=input.note===undefined?'':typeof input.note==='string'&&input.note.length<=2000?input.note.trim():null;
   if(note===null)throw new HttpError(400,'备注不得超过 2000 字');
   if(input.action==='approve-and-schedule') {
    if(item.state!=='pending')throw new HttpError(409,'当前确认状态已变化');
    item.state='approved';
    item.history.push({action:'同意维修',actor:actor.name,note,at:new Date().toISOString()});
   }
   if(scheduling) {
    if(item.state!=='approved')throw new HttpError(409,'请先登记客户同意维修');
    const task=await getDispatchTask(client,id,actor,true);
    const schedulingBlock=pendingRepairScheduleBlock(task.stage);
    if(schedulingBlock)throw new HttpError(409,schedulingBlock);
    if(task.stage==='维修完成'&&(typeof input.dueAt!=='string'||!Number.isFinite(Date.parse(input.dueAt))||Date.parse(input.dueAt)<=Date.now()))throw new HttpError(400,'请选择维修工并填写晚于当前时间的预计完工时间');
    if(task.items.some(i=>i.id===item.itemId))throw new HttpError(409,'项目编号已存在，请管理员核对');
    const reopen=task.stage==='维修完成';
    const command={action:reopen?'reopen-repair':'edit-repair-items',expectedVersion:task.version,requestId:input.requestId,reason:item.reason};
    if(reopen)Object.assign(command,{additionalItems:[item.name],technicianIds:input.technicianId?[input.technicianId]:[],executionMode:input.executionMode||'internal',contractorId:input.contractorId,contractor:input.contractor,outsourcingMode:input.outsourcingMode,serviceUnit:input.serviceUnit,serviceAddress:input.serviceAddress,serviceContact:input.serviceContact,departureAt:input.departureAt,expectedReturnAt:input.expectedReturnAt,handedOverAt:input.handedOverAt,receivedAt:input.receivedAt,dueAt:input.dueAt});
    else Object.assign(command,{repairItems:[...task.items.map(i=>({id:i.id,name:i.name,responsibleId:i.responsibleId})),{name:item.name,...(task.stage==='待派工'||task.executionMode==='outsourced'?{}:{responsibleId:input.technicianId})}]});
    await executeDispatchActionInTransaction(client,actor,id,command,{itemId:item.itemId,additional:reopen});
    item.scheduled=true;
   } else {
    if(item.state!=='pending')throw new HttpError(409,'当前确认状态已变化');
    item.state=input.action==='approve'?'approved':'declined';
    item.history.push({action:{approve:'同意维修',decline:'本次暂不维修'}[input.action],actor:actor.name,note,at:new Date().toISOString()});
   }
   if(scheduling)item.history.push({action:'已安排维修',actor:actor.name,note:'转入正式维修流程',at:new Date().toISOString()});
  }
  await writePendingRepairs(client,id,items);
  await recordPendingRequest(client,id,actor,input);
  return {items,version:row.version+1};
 });wakeRepairWriteback();return result;
}
