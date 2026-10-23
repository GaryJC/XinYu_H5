import { hasAnyRole } from "../../shared/roles.mjs";
import { HttpError } from '../http/HttpError.mjs';
export const hasActiveRepairRound = task => Boolean(task.repairRound && task.stage!=='维修完成');
export function validateReopenItems(input) {
  if(input.reworkItemIds!==undefined && (!Array.isArray(input.reworkItemIds)||input.reworkItemIds.length>200||input.reworkItemIds.some(id=>!Number.isSafeInteger(id))||new Set(input.reworkItemIds).size!==input.reworkItemIds.length)) throw new HttpError(400,'返工项目无效');
  if(input.additionalItems!==undefined && (!Array.isArray(input.additionalItems)||input.additionalItems.length>50||input.additionalItems.some(name=>typeof name!=='string'||!name.trim()||name.length>200))) throw new HttpError(400,'补充项目须填写名称，每项不超过 200 字');
  if(input.action!=='reopen-repair' && (input.reworkItemIds!==undefined||input.additionalItems!==undefined)) throw new HttpError(400,'返工项目只能用于发起返工');
}
export function reopenRepairTask(task,input,actor,now) {
  if(!hasAnyRole(actor, ['manager','advisor','inspector'])) throw new HttpError(403,'仅检验员、服务顾问或管理员可发起返工');
  if(task.stage!=='维修完成') throw new HttpError(409,'仅维修完成的任务可以发起返工');
  if(!input.reason?.trim()) throw new HttpError(400,'请填写返工原因');
  if(!input.dueAt || Date.parse(input.dueAt)<=Date.parse(now)) throw new HttpError(400,'请填写新的预计完工时间，且晚于当前时间');
  const catalog=task.repairCatalog||task.items;
  const ids=input.reworkItemIds||[],names=input.additionalItems||[];
  if(!ids.length&&!names.length) throw new HttpError(400,'请至少选择一个原项目或添加一个补充项目');
  if(ids.some(id=>!catalog.some(i=>i.id===id))) throw new HttpError(400,'所选返工项目不存在');
  let nextId=Math.min(0,...catalog.map(i=>i.id))-1;
  const items=[...ids.map(id=>{const item=catalog.find(i=>i.id===id);return {id:item.id,name:item.name,status:'待派工'};}),...names.map(name=>({id:nextId--,name:name.trim(),status:'待派工'}))];
  const next={...structuredClone(task),items,roundKind:'rework',repairRound:(task.repairRound||0)+1,roundReason:input.reason.trim(),roundOpenedAt:now,roundOpenedBy:actor.id,roundOpenedName:actor.name,rework:true,reworkReason:input.reason.trim(),reworkCount:0,stage:'待派工'};
  // Round progress is fresh. Historical participants remain excluded from self-inspection.
  for(const key of ['acceptedAt','firstStartedAt','startHistoryUnknown','submittedAt','completedAt','completedBy','inspectorId','inspectorName','inspectionClaimedAt','submissionNote','feedback','pausedAt','pauseReason','pauseNote','resumeStage','rejectedItemIds','partsRequirement','partsRequests','workerSubmissions','workHours','workHoursRecordedBy','workHoursRecordedName','workHoursRecordedAt','departureAt','expectedReturnAt','returnedAt','handedOverAt','receivedAt','agreedFee']) delete next[key];
  next.participantIds=[...new Set([...(task.participantIds||[]),...task.items.flatMap(i=>[i.startedBy,i.finishedBy]).filter(Boolean)])];
  return next;
}
