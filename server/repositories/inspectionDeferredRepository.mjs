import {randomUUID} from 'node:crypto';
import {hasAnyRole,hasRole} from '../../shared/roles.mjs';
export async function enqueueDeferredNotifications(client,previous,next,eventId,actor,operation,itemIds,reason,people,requestId) {
 const kinds={deferred:'检验项目待定',schedule:'待定项目派工',cancel:'待定维修已撤销'};
 const source=operation==='schedule'?next:previous;
 const selected=source.items.filter(item=>itemIds.includes(item.id));
 const targets=new Set();
 people.filter(p=>p.active&&p.shopId===next.shopId).forEach(p=>{
  if(operation==='deferred'&&hasAnyRole(p,['advisor','manager']))targets.add(p.id);
  if(operation==='schedule'&&selected.some(item=>item.responsibleId===p.id))targets.add(p.id);
  if(operation==='cancel'&&(hasAnyRole(p,['advisor','manager'])||selected.some(item=>item.responsibleId===p.id)||hasRole(p,'warehouse')&&(previous.partsRequirement||previous.partsRequests?.length||previous.hasPartsHistory)))targets.add(p.id);
 });
 for(const recipient of targets)await client.query(`insert into dispatch_notifications(id,order_id,event_id,recipient_id,kind,payload) values($1,$2,$3,$4,$5,$6) on conflict(event_id,recipient_id,kind) do nothing`,[randomUUID(),next.orderId,eventId,recipient,kinds[operation],JSON.stringify({shopId:next.shopId,orderId:next.orderId,plate:next.plate,dispatchNo:next.dispatchNo,repairRound:next.repairRound||0,itemIds,operation,deferredRequestId:requestId,actorName:actor.name,summary:selected.map(item=>item.name).join('、').slice(0,200),reason,notice:operation==='cancel'?'所列待定项目已撤销维修，请停止施工，核对已申请或领取的配件；退料须另行办理。':operation==='schedule'?'待定项目已派工，请进入任务接单或开始维修。':'检验项目转为待定，不阻止本轮结束，请跟进后续处理。'})]);
}
export async function validateDeferredNotification(row,user,client) {
 if(!user?.active||user.id!==row.recipient_id||user.shopId!==row.payload.shopId)return false;
 const {rows}=await client.query('select w.pending_repairs,d.data,d.stage from work_orders w join dispatch_tasks d on d.order_id=w.id where w.id=$1',[row.order_id]);
 const task=rows[0];if(!task)return false;
 const entries=(task.pending_repairs||[]).filter(p=>row.payload.itemIds?.includes(p.itemId)&&p.source==='inspection');
 if(entries.length!==row.payload.itemIds?.length||entries.some(p=>p.lastOperationRequestId!==row.payload.deferredRequestId))return false;
 if(row.payload.operation==='deferred')return hasAnyRole(user,['advisor','manager'])&&entries.every(p=>p.inspectionState==='pending');
 if(row.payload.operation==='cancel')return entries.every(p=>p.inspectionState==='cancelled')&&(hasAnyRole(user,['advisor','manager','warehouse'])||entries.some(p=>p.cancelledItem?.responsibleId===user.id));
 return (task.data.repairRound||0)===(row.payload.repairRound||0)&&['待接单','待开工','维修中','暂停','回审'].includes(task.stage)&&(hasAnyRole(user,['technician','outsourcing'])||user.outsourcingRoleMember)&&entries.every(p=>p.inspectionState==='scheduled'&&task.data.items.some(i=>i.id===p.itemId&&i.responsibleId===user.id&&!['待检验','已完工'].includes(i.status)));
}
