import {HttpError} from '../http/HttpError.mjs';

export function validateInspectionDeferred(input) {
 if(input.deferredItemIds===undefined&&input.deferredReason===undefined)return;
 const ids=input.deferredItemIds;
 if(input.action!=='inspect'||!Array.isArray(ids)||ids.length>200||ids.some(id=>!Number.isSafeInteger(id))||new Set(ids).size!==ids.length)throw new HttpError(400,'待定项目无效');
 if(ids.some(id=>input.rejectedItemIds?.includes(id)))throw new HttpError(400,'同一项目不能同时退回和待定');
 if(ids.length&&(typeof input.deferredReason!=='string'||!input.deferredReason.trim()||input.deferredReason.length>2000))throw new HttpError(400,'请填写待定原因，最多 2000 字');
}

export function reconcileInspectionDeferred(pending,task,next,input,actor,now) {
 const items=structuredClone(pending);
 for(const id of input.deferredItemIds||[]) {
  const original=task.items.find(item=>item.id===id);
  let entry=items.find(item=>item.itemId===id);
  if(!entry) {entry={id:`inspection-${id}-${task.repairRound||0}`,itemId:id,history:[]};items.push(entry);}
  Object.assign(entry,{source:'inspection',name:original.name,reason:input.deferredReason.trim(),state:'pending',scheduled:false,inspectionState:'pending',sourceRound:task.repairRound||0,sourceRequestId:input.requestId,lastOperationRequestId:input.requestId,originalItem:structuredClone(original)});
  entry.history.push({action:'检验待定',actor:actor.name,actorId:actor.id,at:now,note:input.deferredReason.trim()});
 }
 for(const entry of items) {
  if(entry.source==='inspection'&&entry.inspectionState==='scheduled'&&next.items.some(item=>item.id===entry.itemId&&item.status==='已完工')) {
   entry.inspectionState='completed';
   entry.history.push({action:'检验通过',actor:actor.name,actorId:actor.id,at:now,note:''});
  }
 }
 return items;
}

export function cancelInspectionDeferred(task,entry,actor,note,now) {
 if(!['pending','scheduled'].includes(entry.inspectionState))throw new HttpError(409,'待定项目已处理，请刷新');
 if(typeof note!=='string'||!note.trim()||note.length>2000)throw new HttpError(400,'请填写不再维修原因，最多 2000 字');
 const next=structuredClone(task),item=next.items.find(item=>item.id===entry.itemId);
 if(entry.inspectionState==='scheduled'&&(!item||item.status==='已完工'))throw new HttpError(409,'项目不存在或已检验通过，不能撤销');
 next.items=next.items.filter(item=>item.id!==entry.itemId);
 const archived=item||entry.originalItem;
 if(archived)next.deferredItems=[...(next.deferredItems||[]).filter(i=>i.id!==entry.itemId),structuredClone(archived)];
 if(item) {
  next.participantIds=[...new Set([...(next.participantIds||[]),item.responsibleId,item.startedBy,item.finishedBy].filter(Boolean))];
  next.technicianIds=(next.technicianIds||[next.technicianId]).filter(id=>id&&next.items.some(item=>item.responsibleId===id));
  next.technicianId=next.technicianIds[0];
  next.technicianName=[...new Set(next.items.map(i=>i.responsibleName).filter(Boolean))].join('、');
 }
 if(next.rejectedItemIds)next.rejectedItemIds=next.rejectedItemIds.filter(id=>id!==entry.itemId);
 if(next.items.every(item=>item.status==='已完工'))Object.assign(next,{stage:'维修完成',completedAt:task.stage==='维修完成'?task.completedAt:now,rework:false});
 else if(next.items.every(item=>['待检验','已完工'].includes(item.status)))next.stage='待检验';
 else if(next.stage==='待检验')next.stage='维修中';
 next.version=task.version+1;
 return next;
}
