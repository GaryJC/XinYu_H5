import { HttpError } from '../http/HttpError.mjs';
export const pendingName = name => `【待定】${name.replace(/^(?:【待定】)+/, '')}`;
export function validatePendingText(value, label, max = 200) {
 if(typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new HttpError(400, `${label}不能为空且不得超过 ${max} 字`);
 return value.trim();
}
export function pendingLegacyItems(items = []) {
 return items.filter(p => p.state !== 'declined' && !p.scheduled).map(p => ({id:p.itemId,name:pendingName(p.name),laborFee:0,owner:'待派工',status:'待派工',pendingConfirmation:true}));
}
export function mergePendingWriteback(items, pending = []) {
 const result = new Map(items.map(i => [i.id, {...i}]));
 for(const p of pending) {
  if(p.state === 'declined') {result.delete(p.itemId);continue;}
  const item = result.get(p.itemId);
  if(item?.status === '已完工' && p.state === 'approved' && (p.source!=='inspection'||p.inspectionState==='completed')) continue;
  result.set(p.itemId, {...item,id:p.itemId,name:pendingName(p.name),pendingConfirmation:true});
 }
 return [...result.values()];
}

// Confirmation is a customer decision; progress comes from the actual repair item.
// A later round (including a rework) supersedes the historical completion.
export function pendingRepairProgress(items, task, rounds = []) {
 const latest = new Map();
 for(const round of [...rounds].sort((a,b)=>a.round-b.round)) {
  for(const item of round.task.items||[])latest.set(item.id,{item,task:round.task,round:round.round});
 }
 for(const item of task?.items||[])latest.set(item.id,{item,task,round:task.repairRound||0});
 return items.map(p=>{
  if(p.source==='inspection'&&p.inspectionState==='cancelled')return {...p,progress:'已撤销'};
  if(!p.scheduled)return {...p};
  const found=latest.get(p.itemId);
  if(!found)return {...p,progress:'进度待核对'};
  const {item,task:context,round}=found;
  let progress;
  if(item.status==='已完工')progress='检验通过';
  else if(item.status==='待检验')progress='待检验';
  else if(context.stage==='暂停'||context.workerPauses?.[item.responsibleId])progress='暂停';
  else if(context.stage==='待接单')progress='待接单';
  else if(item.status==='待领料')progress='待开工';
  else if(['待派工','待开工','维修中'].includes(item.status))progress=item.status;
  else progress='进度待核对';
  return {...p,progress,repairRound:round};
 });
}
