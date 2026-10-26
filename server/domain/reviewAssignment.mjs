import {HttpError} from '../http/HttpError.mjs';
import {editRepairItems} from './repairItemEditing.mjs';
import {resolveRepairResponsibilities} from './repairResponsibilities.mjs';

export function addReviewProjects(task,input,actor,people,now) {
  if(task.executionMode==='outsourced')throw new HttpError(409,'外包回审项目由承包方处理');
  for(const item of task.items) {
    const row=input.repairItems.find(row=>row.id===item.id);
    if(!row||row.name!==item.name||row.responsibleId!==undefined&&row.responsibleId!==item.responsibleId)
      throw new HttpError(409,'回审已有项目不可由派工人员修改，只能新增并分配项目');
  }
  const added=input.repairItems.filter(row=>row.id===undefined);
  if(!added.length||added.some(row=>!row.responsibleId))throw new HttpError(400,'请新增项目并指定负责人');
  const next=structuredClone(task);
  editRepairItems(next,input.repairItems,actor,now,{startNewItems:false});
  next.technicianIds=[...new Set([...(task.technicianIds??[task.technicianId]).filter(Boolean),...added.map(row=>row.responsibleId)])];
  resolveRepairResponsibilities(next,people,{required:true,rejectInvalid:true});
  // Preserve existing items exactly, including historical names and inspection records.
  next.items=next.items.map(item=>structuredClone(task.items.find(previous=>previous.id===item.id)||item));
  next.technicianId=next.technicianIds[0];
  next.technicianName=next.technicianIds.map(id=>people.find(p=>p.id===id)?.name||id).join('、');
  if(next.technicianIds.includes(next.inspectorId)) {
    delete next.inspectorId;delete next.inspectorName;delete next.inspectionClaimedAt;
  }
  next.version=task.version+1;
  return next;
}
