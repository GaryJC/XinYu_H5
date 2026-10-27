import {inspectionDeferredOwner} from '../../shared/inspectionDeferredOwnership.mjs';
import {hasAnyRole,hasRole} from '../../shared/roles.mjs';
import {pendingRepairScheduleBlock} from '../../shared/pendingRepairScheduling.mjs';
import {HttpError} from '../http/HttpError.mjs';
import {canInspect,applyDispatchAction,validateDispatchRequest} from '../domain/dispatchPolicy.mjs';
import {cancelInspectionDeferred} from '../domain/inspectionDeferred.mjs';
import {getDispatchTask,dispatchPeople,saveDispatchTask} from '../repositories/dispatchRepository.mjs';
import {saveRepairRound,repairCatalog} from '../repositories/repairRoundRepository.mjs';
import {writePendingRepairs,recordPendingRequest} from '../repositories/pendingRepairsRepository.mjs';
import {enqueueRepairRemoval,enqueueRepairWriteback} from '../repositories/repairWritebackRepository.mjs';
import {enqueueDeferredNotifications,enqueueDeferredReminder} from '../repositories/inspectionDeferredRepository.mjs';

export async function processInspectionDeferred(client,actor,id,input,row) {
 const items=structuredClone(row.items),entry=items.find(p=>p.id===input.id);
 if(entry?.source!=='inspection')throw new HttpError(403,'仅可处理检验待定项目');
 const task=await getDispatchTask(client,id,actor,true);
 await client.query('select id from users where shop_id=$1 order by id for share',[actor.shopId]);
 const people=await dispatchPeople(actor,client);
 const current=people.find(p=>p.id===actor.id);
 if(!current?.active||current.shopId!==task.shopId||!hasAnyRole(current,['inspector','manager']))throw new HttpError(403,'仅本店检验员或管理员可处理检验待定项目');
 const owner=inspectionDeferredOwner(entry);
 if(input.action==='remind-inspector') {
  if(!['pending','scheduled'].includes(entry.inspectionState))throw new HttpError(409,'待定项目已处理，请刷新');
  if(owner.id===current.id)throw new HttpError(409,'您就是原检验人，请直接处理');
  const recipient=people.find(person=>person.id===owner.id);
  if(!recipient||!canInspect(task,recipient))throw new HttpError(409,'原检验人未明确、已停用或已无处理权限，无法发送提醒，请联系管理员核对');
  if(Date.now()-Date.parse(entry.lastReminderAt)<60000)throw new HttpError(409,'刚刚已提醒原检验人，请稍后再试');
  entry.lastReminderAt=new Date().toISOString();
  entry.history.push({action:'提醒原检验人处理',actor:current.name,actorId:current.id,at:entry.lastReminderAt,note:`已加入通知队列，接收人：${recipient.name}`});
  await writePendingRepairs(client,id,items);
  await enqueueDeferredReminder(client,task,entry,current,recipient,input);
  await recordPendingRequest(client,id,current,input);
  return {items,version:row.version+1};
 }
 if(!owner.id||owner.id!==current.id)throw new HttpError(403,`仅原检验人${owner.name}可处理，请使用提醒原检验人按钮`);
 if(!canInspect(task,current))throw new HttpError(403,'原检验人当前无独立检验权限，请联系管理员核对');
 if(task.needsReview)throw new HttpError(409,'请先核对历史任务');
 if(input.note!==undefined&&(typeof input.note!=='string'||input.note.length>2000))throw new HttpError(400,'备注不得超过 2000 字');
 const now=new Date().toISOString();let next,operation;
 if(input.action==='schedule') {
  if(entry.inspectionState!=='pending')throw new HttpError(409,'项目已派工或处理，请刷新');
  const block=pendingRepairScheduleBlock(task.stage);if(block)throw new HttpError(409,block);
  if(!['维修完成','维修中','待开工','暂停','待接单','回审'].includes(task.stage))throw new HttpError(409,'当前阶段不能安排待定维修');
  if(typeof input.dueAt!=='string'||!input.dueAt||!Number.isFinite(Date.parse(input.dueAt))||Date.parse(input.dueAt)<=Date.now())throw new HttpError(400,'请填写晚于当前时间的预计完工时间');
  const mode=task.stage==='维修完成'?(input.executionMode||'internal'):(task.executionMode||'internal');
  const workerId=mode==='outsourced'?(input.contractorId||task.contractorId):input.technicianId;
  const worker=people.find(p=>p.id===workerId&&p.active&&p.shopId===task.shopId&&(mode==='outsourced'?(hasRole(p,'outsourcing')||p.outsourcingRoleMember):hasRole(p,'technician')));
  if(mode==='outsourced'&&task.stage!=='维修完成'&&workerId!==task.contractorId)throw new HttpError(409,'本轮外包待定项目须交给当前承包方；更换承包方请先结束本轮');
  if(!worker)throw new HttpError(400,'请选择本店有效维修工');
  if(task.items.some(i=>i.id===entry.itemId))throw new HttpError(409,'待定项目已在维修流程中');
  if(task.stage==='维修完成') {
   task.repairCatalog=await repairCatalog(client,task);
   next=applyDispatchAction(task,validateDispatchRequest({...input,action:'reopen-repair',requestId:input.requestId,expectedVersion:task.version,additionalItems:[entry.name],reason:entry.reason,dueAt:input.dueAt,technicianIds:mode==='outsourced'?[]:[worker.id],contractorId:mode==='outsourced'?worker.id:undefined,executionMode:mode}),current,people,now);
   next.items[0].id=entry.itemId;next.roundKind='additional';next.rework=false;
  } else {
   next=structuredClone(task);next.version++;
   next.items.push({id:entry.itemId,name:entry.name,status:'待开工',responsibleId:worker.id,responsibleName:worker.name});
   next.technicianIds=[...new Set([...(task.technicianIds||[task.technicianId]).filter(Boolean),worker.id])];
   next.technicianName=next.technicianIds.map(id=>people.find(p=>p.id===id)?.name||id).join('、');
   next.dueAt=new Date(Math.max(Date.parse(task.dueAt)||0,Date.parse(input.dueAt))).toISOString();
   if(next.workerSubmissions)delete next.workerSubmissions[worker.id];
  }
  next.deferredItems=(next.deferredItems||[]).filter(i=>i.id!==entry.itemId);
  entry.state='approved';entry.scheduled=true;entry.inspectionState='scheduled';operation='schedule';
 } else if(['decline','cancel'].includes(input.action)) {
  if(input.action==='decline'&&entry.inspectionState!=='pending'||input.action==='cancel'&&entry.inspectionState!=='scheduled')throw new HttpError(409,'待定项目状态已变化');
  next=cancelInspectionDeferred(task,entry,current,input.note,now);
  entry.cancelledItem=task.items.find(i=>i.id===entry.itemId)||entry.originalItem;
  entry.state='declined';entry.inspectionState='cancelled';operation='cancel';
 } else throw new HttpError(400,'检验待定项目只允许派工、删除或撤销');
 entry.lastOperationRequestId=input.requestId;
 entry.history.push({action:operation==='schedule'?'检验员直接派工':input.action==='decline'?'删除／不再维修':'撤销维修',actor:current.name,actorId:current.id,at:now,note:input.note||''});
 await writePendingRepairs(client,id,items);
 await saveRepairRound(client,task,next,current,operation==='schedule'&&task.stage==='维修完成'?'reopen-repair':'inspection-deferred');
 await saveDispatchTask(client,next);
 const {rows:[event]}=await client.query('insert into dispatch_events(order_id,actor_id,actor_name,request_id,request_body,action,detail) values($1,$2,$3,$4,$5,$6,$7) returning id',[id,current.id,current.name,input.requestId,JSON.stringify(input),`inspection-deferred-${operation}`,JSON.stringify({stage:next.stage,items:next.items,previousItems:task.items,itemId:entry.itemId,reason:input.note||entry.reason,repairRound:next.repairRound})]);
 if(operation==='cancel') {
  // Finishing by cancellation has no later inspection to publish passed work.
  // Keep local cancellation independent from legacy availability/bindings;
  // invalid full snapshots remain visible and recoverable through retry.
  if(task.stage!=='维修完成'&&next.stage==='维修完成')await enqueueRepairWriteback(client,next,event.id,{deferValidation:true});
  else await enqueueRepairRemoval(client,next,event.id,entry);
 }
 await enqueueDeferredNotifications(client,operation==='cancel'&&!task.items.some(i=>i.id===entry.itemId)?{...task,items:[...task.items,entry.originalItem]}:task,next,event.id,current,operation,[entry.itemId],input.note||entry.reason,people,input.requestId);
 await recordPendingRequest(client,id,current,input);
 return {items,version:row.version+1};
}
