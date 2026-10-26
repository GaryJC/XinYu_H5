export const hasPendingInspection = task => !task.needsReview && ['维修中','回审','待检验','暂停'].includes(task.stage) && task.items.some(item=>item.status==='待检验');
export const allWorkersHaveItems = task => (task.technicianIds ?? (task.technicianId?[task.technicianId]:[])).every(id=>task.items.some(item=>item.responsibleId===id));

// A personal pause survives team changes, including legacy tasks without personal parts requests.
export const isIndividualRepair = task => (task.technicianIds??(task.technicianId?[task.technicianId]:[])).length>1||Boolean(task.partsRequests?.length)||Object.keys(task.workerPauses||{}).length>0;
