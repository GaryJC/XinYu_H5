import {hasRole} from '../../shared/roles.mjs';
const metrics=['unfinished','working','waiting','parts','pickup','paused','inspection','overdue'];
const empty=()=>Object.fromEntries(metrics.map(key=>[key,0]));
function materialProgress(parts,ownerId,shared=false) {
 if(!parts||parts.mode==='none'||parts.issuedAt)return {waiting:false,pickup:false};
 // Shared lines concern their recipient; unallocated legacy lines remain shared.
 const items=(parts.items||[]).filter(item=>!shared||!item.recipientId||item.recipientId===ownerId);
 if(parts.items?.length&&!items.length)return {waiting:false,pickup:false};
 if(!items.length)return {waiting:!parts.preparedAt,pickup:!!parts.preparedAt};
 return {waiting:items.some(item=>!item.issuedAt&&!item.preparedAt&&!parts.preparedAt),
  pickup:items.some(item=>!item.issuedAt&&(item.preparedAt||parts.preparedAt))};
}
// Used by both the per-person workload chart and the per-order onsite dashboard.
export function openTaskProjects(task,peopleById,now) {
 const projects=[];
 if(task.needsReview||['草稿','待客户签字','待处理纸质委托书'].includes(task.orderStatus)||task.stage==='维修完成')return projects;
  const ids=task.technicianIds??(task.technicianId?[task.technicianId]:[]);
  for(const item of task.items){
   if(item.status==='已完工')continue;
   const external=task.executionMode==='outsourced';
   const ownerId=external?undefined:item.responsibleId||(ids.length===1?ids[0]:undefined);
   const person=peopleById.get(ownerId);
   const ownerName=external?`外包 · ${task.contractor||'未记录'}`:person?.name||item.responsibleName||(ids.length===1&&ids[0]===ownerId&&task.technicianName)||'待指定';
   const pause=ownerId&&task.workerPauses?.[ownerId];
   const parts=(task.partsRequests||[]).filter(p=>external||p.ownerId===ownerId).map(p=>({...materialProgress(p,ownerId),recordedAt:p.recordedAt}));
   if(task.partsRequirement)parts.push({...materialProgress(task.partsRequirement,ownerId,!external),recordedAt:task.partsRequirement.recordedAt});
   const waitingParts=parts.filter(p=>p.waiting),pickup=parts.some(p=>p.pickup);
   const inspection=item.status==='待检验';
   const flags=['unfinished'];
   if(inspection)flags.push('inspection');
   else {
    if(pause||task.stage==='暂停')flags.push('paused');
    else if(item.status==='维修中')flags.push('working');
    else flags.push('waiting');
    if(waitingParts.length)flags.push('parts');
    if(pickup)flags.push('pickup');
   }
   if(task.dueAt&&Date.parse(task.dueAt)<now.getTime())flags.push('overdue');
   const note=inspection?'等待检验':pause?.pauseReason|| (task.stage==='暂停'?task.pauseReason:'') || (waitingParts.length?(pickup?'部分备齐，等待出库':'等待仓库备料'):pickup?'已备齐，等待出库':task.stage==='待接单'?'等待接单':'');
   // Keep each wait clock separate when an owner is both paused and short of parts.
   let partsWaitingSince;
   for(const part of waitingParts){
    const time=Date.parse(part.recordedAt);
    if(Number.isFinite(time)&&(!partsWaitingSince||time<Date.parse(partsWaitingSince)))partsWaitingSince=part.recordedAt;
   }
   const waitingSince=inspection?item.finishAt:pause?.pausedAt||(task.stage==='暂停'?task.pausedAt:undefined)||partsWaitingSince|| (task.stage==='待接单'?task.assignedAt:undefined);
   projects.push({key:`${task.orderId}:${task.repairRound||0}:${item.id}`,orderId:task.orderId,plate:task.plate,dispatchNo:task.dispatchNo,createdAt:task.createdAt,name:item.name,ownerId,ownerName,status:inspection?'待检验':flags.includes('paused')?'暂停':item.status,dueAt:task.dueAt,flags,waitingSince,partsWaitingSince,note});
  }
 return projects;
}
export function buildOperationsDashboard(tasks,people,now=new Date()) {
 const peopleById=new Map(people.map(person=>[person.id,person]));
 const projects=[],workers=new Map();let uncertain=0;
 for(const p of people)if(p.active&&hasRole(p,'technician'))workers.set(p.id,{id:p.id,name:p.name,assignable:true,vehicles:0,counts:empty()});
 const live=tasks.filter(t=>!['草稿','待客户签字','待处理纸质委托书'].includes(t.orderStatus)&&t.stage!=='维修完成');
 for(const task of live){
  if(task.needsReview){uncertain++;continue;}
  for(const {partsWaitingSince,...project} of openTaskProjects(task,peopleById,now)){
   projects.push(project);
   const {ownerId,ownerName}=project;
   if(ownerId&&!workers.has(ownerId)){
    const person=peopleById.get(ownerId);
    workers.set(ownerId,{id:ownerId,name:ownerName,assignable:!!person?.active&&hasRole(person,'technician'),vehicles:0,counts:empty()});
   }
  }
 }
 const counts=empty();for(const p of projects)for(const flag of p.flags)counts[flag]++;
 for(const worker of workers.values()){
  const own=projects.filter(p=>p.ownerId===worker.id);worker.vehicles=new Set(own.map(p=>p.orderId)).size;
  for(const p of own)for(const flag of p.flags)worker.counts[flag]++;
 }
 return {generatedAt:now.toISOString(),vehicles:live.length,unassigned:projects.filter(p=>!p.ownerId&&!p.ownerName.startsWith('外包 · ')).length,uncertain,counts,workers:[...workers.values()].sort((a,b)=>b.counts.unfinished-a.counts.unfinished||a.name.localeCompare(b.name)),projects};
}
