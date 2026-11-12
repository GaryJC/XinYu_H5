export const hasPendingInspection = task => task.executionMode!=='outsourced' && !task.needsReview && ['维修中','回审','待检验','暂停'].includes(task.stage) && task.items.some(item=>item.status==='待检验');
export const allWorkersHaveItems = task => (task.technicianIds ?? (task.technicianId?[task.technicianId]:[])).every(id=>[...task.items,...(task.deferredItems||[])].some(item=>item.responsibleId===id));

// A personal pause survives team changes, including legacy tasks without personal parts requests.
export const isIndividualRepair = task => task.executionMode!=='outsourced' && ((task.technicianIds??(task.technicianId?[task.technicianId]:[])).length>1||Boolean(task.partsRequests?.length)||Object.keys(task.workerPauses||{}).length>0||Object.keys(task.workerOffers||{}).length>0);

// A declined/reopened personal offer must survive a coworker's acceptance.
export function personalWorkOffer(task,ownerId) {
 if(task.executionMode==='outsourced'||!['待接单','待开工','维修中','待检验','回审','暂停'].includes(task.stage))return undefined;
 if(!(task.technicianIds??(task.technicianId?[task.technicianId]:[])).includes(ownerId))return undefined;
 return task.workerOffers?.[ownerId];
}
export const declinedWorkOffers = task => Object.entries(task.workerOffers||{}).filter(([id])=>personalWorkOffer(task,id)?.status==='declined');
export const hasDeclinedWork = task => Boolean(task.stage==='待接单'&&task.feedback||declinedWorkOffers(task).length);
// Unknown legacy feedback remains a whole-task gate until a scheduler handles it.
export const personalFeedback = (task,ownerId) => task.feedback||(personalWorkOffer(task,ownerId)?.status==='declined'?task.workerOffers[ownerId].reason:undefined);

// Display and personal-list classification only; never replace the workflow stage.
export function personalRepairStage(task,ownerId) {
 if(!isIndividualRepair(task)||task.needsReview||!['待开工','维修中','待检验','回审','暂停'].includes(task.stage))return task.stage;
 if(task.workerPauses?.[ownerId])return '暂停';
 if(task.stage==='暂停')return task.stage;
 if(personalWorkOffer(task,ownerId))return '待接单';
 const own=task.items.filter(item=>item.responsibleId===ownerId);
 if(!own.length)return task.stage;
 if(task.stage==='回审') {
  if(own.every(item=>item.status==='已完工'))return '维修完成';
  if(own.every(item=>['待检验','已完工'].includes(item.status))&&task.workerSubmissions?.[ownerId])return '待检验';
  return '回审';
 }
 if(own.some(item=>item.status==='维修中'))return '维修中';
 if(own.some(item=>['待派工','待领料','待开工'].includes(item.status)))return '待开工';
 if(own.every(item=>item.status==='已完工'))return '维修完成';
 // Legacy per-item completion still needs an explicit personal submission.
 if(task.workerSubmissions?.[ownerId]||task.stage==='待检验')return '待检验';
 return task.stage;
}

export const hasUnpreparedParts = task => [task.partsRequirement,...(task.executionMode==='outsourced'?task.partsRequests||[]:[])].some(parts=>parts&&parts.mode!=='none'&&!parts.issuedAt&&!parts.preparedAt);

// A satisfied personal request supersedes the legacy shared gate only for that worker.
export function hasUnpreparedSharedParts(task,ownerId) {
 if(!isIndividualRepair(task))return false;
 const personal=task.partsRequests?.find(parts=>parts.ownerId===ownerId);
 if(personal&&!hasUnpreparedParts({partsRequirement:personal}))return false;
 return hasUnpreparedParts({partsRequirement:task.partsRequirement});
}

// Starting needs some usable material; completion still requires the full request.
export function canStartRepairWithParts(task,ownerId=task.technicianId,sharedPartsRequirement) {
 if(task.executionMode==='outsourced')return !hasUnpreparedParts(task)&&!hasUnpreparedParts({partsRequirement:sharedPartsRequirement});
 if(personalWorkOffer(task,ownerId))return false;
 const individual=isIndividualRepair(task);
 const personal=individual?task.partsRequests?.find(parts=>parts.ownerId===ownerId):task.partsRequirement;
 if(personal?.mode==='none')return true;
 const shared=sharedPartsRequirement??(individual?task.partsRequirement:undefined);
 const needs=parts=>Boolean(parts&&parts.mode!=='none');
 const ready=parts=>Boolean(parts?.preparedAt||parts?.issuedAt||parts?.items?.some(item=>item.preparedAt||item.issuedAt));
 const sharedReady=explicit=>{
  if(!needs(shared))return false;
  const assigned=shared.items?.filter(item=>item.recipientId)||[];
  if(assigned.some(item=>item.recipientId===ownerId&&(item.preparedAt||item.issuedAt||shared.preparedAt||shared.issuedAt)))return true;
  // Legacy whole-batch confirmations have no per-person allocation. Do not
  // use them to bypass a separate personal request that has no ready material.
  return !explicit&&!assigned.length&&Boolean(shared.preparedAt||shared.issuedAt);
 };
 if(needs(personal))return ready(personal)||sharedReady(true);
 return needs(shared)?sharedReady(false):true;
}

// Rework is an overlapping classification, scoped to the current worker when supplied.
export function isReworkTask(task, ownerId) {
 const stage=ownerId?personalRepairStage(task,ownerId):task.stage;
 if(!['待接单','待开工','维修中','暂停','待检验','回审'].includes(stage))return false;
 const owners=task.technicianIds??(task.technicianId?[task.technicianId]:[]);
 const own=ownerId?task.items.filter(i=>i.responsibleId===ownerId||!i.responsibleId&&owners.length===1&&owners[0]===ownerId):task.items;
 if(ownerId&&!own.some(i=>i.status!=='已完工'))return false;
 if(task.repairRound&&task.roundKind!=='additional')return true;
 const rejected=new Set(task.rejectedItemIds||[]);
 if(own.some(i=>i.status!=='已完工'&&(i.rejectionReason||rejected.has(i.id))))return true;
 // Legacy flags are usable only when there is no project-level evidence to contradict them.
 return Boolean(task.rework&&!task.items.some(i=>i.rejectionReason)&&!rejected.size);
}
