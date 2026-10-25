export const hasPendingInspection = task => !task.needsReview && ['维修中','回审','待检验','暂停'].includes(task.stage) && task.items.some(item=>item.status==='待检验');
export const allWorkersHaveItems = task => (task.technicianIds ?? (task.technicianId?[task.technicianId]:[])).every(id=>task.items.some(item=>item.responsibleId===id));
