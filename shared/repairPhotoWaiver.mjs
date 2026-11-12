import {hasAnyRole,hasRole} from './roles.mjs';
import {isIndividualRepair,personalWorkOffer} from './repairProgress.mjs';

const workers=task=>task.technicianIds??(task.technicianId?[task.technicianId]:[]);
const ownItems=(task,id)=>task.executionMode==='outsourced'?task.items:task.items.filter(item=>item.responsibleId===id||!item.responsibleId&&workers(task).length===1&&workers(task)[0]===id);
// Status/timestamps change during normal repair. Assignment, projects and rework
// define the approved scope; inspection returns explicitly remove approvals
// for affected owners so one worker's rework does not invalidate a peer.
export function repairPhotoWaiverScope(task,id) {
 return JSON.stringify([task.orderId,task.shopId,task.repairRound||0,task.assignedAt||'',task.executionMode||'internal',
  task.executionMode==='outsourced'?task.assignedBy:workers(task).includes(id),
  ownItems(task,id).map(item=>[item.id,item.name,item.responsibleId||id]).sort((a,b)=>a[0]-b[0])]);
}
export function currentPhotoWaiver(task,id) {
 const entry=task.repairPhotoWaivers?.find(row=>row.applicantId===id);
 return entry?.scope===repairPhotoWaiverScope(task,id)?entry:undefined;
}
export function hasApprovedPhotoWaiver(task,id) {
 const entry=currentPhotoWaiver(task,id);
 return Boolean(entry?.status==='approved'&&entry.decidedBy&&entry.decidedBy!==id);
}
export function canRequestPhotoWaiver(task,actor) {
 if(!actor?.active||actor.shopId!==task.shopId||task.needsReview||['草稿','待客户签字','待处理纸质委托书'].includes(task.orderStatus))return false;
 if(!['待开工','维修中','暂停','回审',...(task.executionMode==='outsourced'?['待检验']:[])].includes(task.stage))return false;
 if(task.executionMode==='outsourced')return hasAnyRole(actor,['manager','advisor'])&&task.items.length>0;
 if(!hasRole(actor,'technician')||!workers(task).includes(actor.id)||personalWorkOffer(task,actor.id))return false;
 const own=ownItems(task,actor.id);
 if(!own.length||own.every(item=>item.status==='已完工'))return false;
 return !(isIndividualRepair(task)&&own.every(item=>['待检验','已完工'].includes(item.status))&&task.workerSubmissions?.[actor.id]);
}
export function pendingPhotoWaivers(task) {
 if(task.needsReview||!['待开工','维修中','暂停','回审',...(task.executionMode==='outsourced'?['待检验']:[])].includes(task.stage))return [];
 return (task.repairPhotoWaivers||[]).filter(entry=>entry.status==='pending'&&currentPhotoWaiver(task,entry.applicantId)===entry
  && ownItems(task,entry.applicantId).some(item=>item.status!=='已完工')
  && !(task.workerSubmissions?.[entry.applicantId]&&ownItems(task,entry.applicantId).every(item=>['待检验','已完工'].includes(item.status))));
}
