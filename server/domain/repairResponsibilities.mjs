import { hasRole } from "../../shared/roles.mjs";
import {HttpError} from '../http/HttpError.mjs';
// Names are resolved from authenticated shop personnel, never from request labels.
export function resolveRepairResponsibilities(task,people,{required=false,rejectInvalid=false}={}) {
 if(task.executionMode==='outsourced')return task;
 const ids=task.technicianIds??(task.technicianId?[task.technicianId]:[]);
 for(const item of task.items) {
  const locked=['待检验','已完工'].includes(item.status);
  // Submitted work keeps its server-recorded owner after handover, even if that
  // employee has since left the current team. Client edits cannot change locked owners.
  if(locked&&item.responsibleId)continue;
  if(!item.responsibleId&&ids.length===1)item.responsibleId=ids[0];
  const person=people.find(p=>p.id===item.responsibleId&&ids.includes(p.id)&&p.active&&(task.executionMode==='outsourced'?(hasRole(p, 'outsourcing')||p.outsourcingRoleMember):hasRole(p, 'technician'))&&p.shopId===task.shopId);
  if(!person) {
   if(required||rejectInvalid&&item.responsibleId)throw new HttpError(409,`请为维修项目“${item.name}”指定有效负责人`);
   if(!locked){delete item.responsibleId;delete item.responsibleName;}
  } else if(!locked||!item.responsibleName)item.responsibleName=person.name;
 }
 return task;
}

export function transferUnfinishedResponsibilities(task) {
 const ids=task.technicianIds??(task.technicianId?[task.technicianId]:[]);
 for(const item of task.items) {
  if(['待检验','已完工'].includes(item.status))continue;
  delete item.responsibleId;delete item.responsibleName;
  if((task.executionMode!=='outsourced'||task.contractorId)&&ids.length===1)item.responsibleId=ids[0];
 }
}
