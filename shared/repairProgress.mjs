export const hasPendingInspection = task => task.executionMode!=='outsourced' && !task.needsReview && ['维修中','回审','待检验','暂停'].includes(task.stage) && task.items.some(item=>item.status==='待检验');
export const allWorkersHaveItems = task => (task.technicianIds ?? (task.technicianId?[task.technicianId]:[])).every(id=>[...task.items,...(task.deferredItems||[])].some(item=>item.responsibleId===id));

// A personal pause survives team changes, including legacy tasks without personal parts requests.
export const isIndividualRepair = task => task.executionMode!=='outsourced' && ((task.technicianIds??(task.technicianId?[task.technicianId]:[])).length>1||Boolean(task.partsRequests?.length)||Object.keys(task.workerPauses||{}).length>0);

// Display and personal-list classification only; never replace the workflow stage.
export function personalRepairStage(task,ownerId) {
 if(!isIndividualRepair(task)||task.needsReview||!['待开工','维修中','待检验','回审','暂停'].includes(task.stage))return task.stage;
 if(task.workerPauses?.[ownerId])return '暂停';
 if(['回审','暂停'].includes(task.stage))return task.stage;
 const own=task.items.filter(item=>item.responsibleId===ownerId);
 if(!own.length)return task.stage;
 if(own.some(item=>item.status==='维修中'))return '维修中';
 if(own.some(item=>['待派工','待领料','待开工'].includes(item.status)))return '待开工';
 if(own.every(item=>item.status==='已完工'))return '维修完成';
 // Legacy per-item completion still needs an explicit personal submission.
 if(task.workerSubmissions?.[ownerId]||task.stage==='待检验')return '待检验';
 return task.stage;
}

export const hasUnpreparedParts = task => [task.partsRequirement,...(task.executionMode==='outsourced'?task.partsRequests||[]:[])].some(parts=>parts&&parts.mode!=='none'&&!parts.issuedAt&&!parts.preparedAt);

// Starting needs some usable material; completion still requires the full request.
export function canStartRepairWithParts(task,ownerId=task.technicianId,sharedPartsRequirement) {
 if(task.executionMode==='outsourced')return !hasUnpreparedParts(task)&&!hasUnpreparedParts({partsRequirement:sharedPartsRequirement});
 const individual=isIndividualRepair(task);
 const personal=individual?task.partsRequests?.find(parts=>parts.ownerId===ownerId):task.partsRequirement;
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
