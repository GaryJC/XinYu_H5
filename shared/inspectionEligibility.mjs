import {hasRole,hasAnyRole} from './roles.mjs';
// Participation restricts ordinary internal technicians only; inspection permission
// itself is checked separately by the caller.
export function allowsInspectionParticipation(task,user) {
 if(hasAnyRole(user,['manager','advisor','inspector'])||!hasRole(user,'technician')||task.executionMode==='field')return true;
 const workers=task.technicianIds??(task.technicianId?[task.technicianId]:[]);
 return task.technicianId!==user.id&&!workers.includes(user.id)&&!(task.participantIds||[]).includes(user.id)&&!task.items.some(i=>i.responsibleId===user.id||i.startedBy===user.id||i.finishedBy===user.id);
}
