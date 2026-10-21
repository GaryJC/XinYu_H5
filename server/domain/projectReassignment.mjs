import {HttpError} from '../http/HttpError.mjs';

export function validateProjectReassignment(input) {
  if(input.reassignItemIds===undefined)return;
  const ids=input.reassignItemIds;
  if(input.action!=='reassign'||!Array.isArray(ids)||!ids.length||ids.length>200||ids.some(id=>!Number.isSafeInteger(id))||new Set(ids).size!==ids.length)
    throw new HttpError(400,'请选择需要改派的维修项目');
  if(!Array.isArray(input.repairItems)||input.repairItems.length!==ids.length||input.repairItems.some(row=>!ids.includes(row?.id)))
    throw new HttpError(400,'改派项目与负责人名单不一致');
  if(['technicianId','technicianIds','executionMode','contractorId','contractor','outsourcingMode','dueAt','urgent'].some(key=>input[key]!==undefined))
    throw new HttpError(400,'项目改派不调整整单人员、执行方式或时间');
}

export function reassignProjects(next,input,people) {
  if(next.executionMode==='outsourced')throw new HttpError(409,'外包任务请使用整单改派调整承包方');
  const previousParticipants=new Set(next.participantIds||[]);
  for(const row of input.repairItems) {
    const item=next.items.find(item=>item.id===row.id);
    if(!item)throw new HttpError(409,'维修项目不存在，请刷新');
    if(['待检验','已完工'].includes(item.status))throw new HttpError(409,'已提检或检验通过的项目不可改派');
    if(row.name!==item.name)throw new HttpError(400,'请通过维修项目编辑入口修改名称');
    const person=people.find(p=>p.id===row.responsibleId&&p.active&&p.shopId===next.shopId&&p.role==='technician');
    if(!person)throw new HttpError(400,`请为维修项目“${item.name}”选择本店有效维修工`);
    if(person.id===item.responsibleId)throw new HttpError(409,`维修项目“${item.name}”请选择其他维修工`);
    if(item.startAt)for(const id of [item.responsibleId,item.startedBy,item.finishedBy])if(id)previousParticipants.add(id);
    Object.assign(item,{responsibleId:person.id,responsibleName:person.name});
  }
  // Preserve the team for legacy projects whose owner has not yet been confirmed.
  const fallback=next.items.some(i=>!i.responsibleId)?next.technicianIds??(next.technicianId?[next.technicianId]:[]):[];
  const ids=[...new Set([...fallback,...next.items.map(i=>i.responsibleId).filter(Boolean)])];
  next.technicianIds=ids;next.technicianId=ids[0];
  next.technicianName=ids.map(id=>people.find(p=>p.id===id)?.name||next.items.find(i=>i.responsibleId===id)?.responsibleName||id).join('、');
  next.participantIds=[...previousParticipants];
}
