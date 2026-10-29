export const hasPendingInspection = task => task.executionMode!=='outsourced' && !task.needsReview && ['维修中','回审','待检验','暂停'].includes(task.stage) && task.items.some(item=>item.status==='待检验');
export const allWorkersHaveItems = task => (task.technicianIds ?? (task.technicianId?[task.technicianId]:[])).every(id=>[...task.items,...(task.deferredItems||[])].some(item=>item.responsibleId===id));

// A personal pause survives team changes, including legacy tasks without personal parts requests.
export const isIndividualRepair = task => task.executionMode!=='outsourced' && ((task.technicianIds??(task.technicianId?[task.technicianId]:[])).length>1||Boolean(task.partsRequests?.length)||Object.keys(task.workerPauses||{}).length>0);

export const hasUnpreparedParts = task => [task.partsRequirement,...(task.executionMode==='outsourced'?task.partsRequests||[]:[])].some(parts=>parts&&parts.mode!=='none'&&!parts.issuedAt&&!parts.preparedAt);
