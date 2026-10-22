import {HttpError} from '../http/HttpError.mjs';
const workers=task=>task.technicianIds??(task.technicianId?[task.technicianId]:[]);
export const individualRepair=task=>workers(task).length>1||Boolean(task.partsRequests?.length);
export function personalParts(task,ownerId) {return task.partsRequests?.find(p=>p.ownerId===ownerId);}
export function actionParts(task,input,actor) {
  const owner=input.partsOwnerId??(['accept','record-parts'].includes(input.action)&&individualRepair(task)?actor.id:undefined);
  return owner?personalParts(task,owner):task.partsRequirement;
}
// Run an existing transition against one worker's items, then merge only that scope.
export function applyIndividualAction(task,input,actor,people,now,apply) {
  const repairActions=['start-order','submit-order','start','finish','pick','edit-repair-items'];
  const warehouse=['edit-parts','confirm-parts','issue-parts'].includes(input.action);
  const personal=workers(task).includes(actor.id)&&(['technician','outsourcing'].includes(actor.role)||actor.outsourcingRoleMember);
  const scopedParts=warehouse&&input.partsOwnerId || personal&&['accept','record-parts'].includes(input.action)&&individualRepair(task);
  const scopedRepair=personal&&repairActions.includes(input.action)&&individualRepair(task);
  if(!scopedParts&&!scopedRepair)return;
  if(scopedRepair&&input.action==='finish')throw new HttpError(409,'请通过提交本人完工入口操作');
  const ownerId=warehouse?input.partsOwnerId:actor.id;
  if(input.partsOwnerId&&input.partsOwnerId!==ownerId)throw new HttpError(403,'只能操作本人的领料申请');
  const own=task.items.filter(i=>i.responsibleId===ownerId);
  if(!own.length&&!warehouse)throw new HttpError(409,'尚未分配本人维修项目，请联系服务顾问');
  if(input.action==='record-parts'&&own.every(i=>['待检验','已完工'].includes(i.status)))throw new HttpError(409,'本人项目已提交，不能再申请领料');
  const requirement=personalParts(task,ownerId);
  if(warehouse&&!requirement)throw new HttpError(409,'领料申请不存在，请刷新');
  if(scopedRepair&&task.partsRequirement?.mode!=='none'&&task.partsRequirement&&!task.partsRequirement.issuedAt&&!task.partsRequirement.preparedAt)
    throw new HttpError(409,'历史共同配件尚未备齐，请等待仓库确认');
  if(input.repairItems?.some(row=>row.id!==undefined&&!own.some(i=>i.id===row.id)||row.responsibleId&&row.responsibleId!==ownerId))throw new HttpError(403,'只能编辑和提交本人负责的项目');
  if(input.itemId!==undefined&&!own.some(i=>i.id===input.itemId))throw new HttpError(403,'只能操作本人负责的项目');
  const owner=people.find(p=>p.id===ownerId);
  const scoped={...task,items:own,repairCatalog:task.repairCatalog||task.items,technicianIds:[ownerId],technicianId:ownerId,technicianName:owner?.name||own[0]?.responsibleName||ownerId,partsRequirement:requirement,partsRequests:undefined};
  if(scopedParts&&task.stage==='维修中'&&own.length&&own.every(i=>['待开工','待派工','待领料'].includes(i.status)))scoped.stage='待开工';
  if(scopedRepair&&input.action==='submit-order'&&own.every(i=>['待检验','已完工'].includes(i.status))&&(task.workerSubmissions?.[ownerId]||own.every(i=>i.status==='已完工')))throw new HttpError(409,'本人项目已提交，请勿重复操作');
  const changed=apply(scoped,{...input,partsOwnerId:undefined,repairItems:input.repairItems?.map(row=>({...row,responsibleId:ownerId}))},actor,people,now,warehouse?workers(task):undefined);
  const next={...task,version:changed.version,items:task.items.map(i=>own.some(o=>o.id===i.id)?changed.items.find(c=>c.id===i.id)||i:i)};
  next.items.push(...changed.items.filter(i=>!own.some(o=>o.id===i.id)));
  next.participantIds=[...new Set([...(task.participantIds||[]),...(changed.participantIds||[])])];
  if(task.stage==='暂停'&&changed.resumeStage==='维修中')next.resumeStage='维修中';
  next.firstStartedAt=task.firstStartedAt||changed.firstStartedAt;
  next.acceptedAt=task.acceptedAt||changed.acceptedAt;
  next.repairItemIdFloor=changed.repairItemIdFloor??task.repairItemIdFloor;
  if(scopedParts)next.partsRequests=[...(task.partsRequests||[]).filter(p=>p.ownerId!==ownerId),{...changed.partsRequirement,ownerId,ownerName:scoped.technicianName}];
  if(input.action==='submit-order')next.workerSubmissions={...task.workerSubmissions,[ownerId]:{at:now,note:input.note||''}};
  const allDone=next.items.every(i=>['待检验','已完工'].includes(i.status));
  if(input.action==='submit-order'&&allDone)Object.assign(next,{stage:'待检验',inspectorId:undefined,inspectorName:undefined,submittedAt:now,submissionNote:Object.entries(next.workerSubmissions||{}).map(([id,s])=>`${people.find(p=>p.id===id)?.name||id}：${s.note}`).join('\n')});
  else if(task.stage!=='暂停'&&['待接单','待开工','维修中'].includes(task.stage))next.stage=next.items.some(i=>['维修中','待检验','已完工'].includes(i.status))?'维修中':'待开工';
  return next;
}
