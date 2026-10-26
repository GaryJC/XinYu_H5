import {hasRole} from '../../shared/roles.mjs';
import {resolveRepairResponsibilities} from './repairResponsibilities.mjs';
import {HttpError} from '../http/HttpError.mjs';

export function sendReview(task,actor,canInspect,people) {
  if(!['待检验','维修完成'].includes(task.stage)) throw new HttpError(409,'仅待检验或已检验的任务可发送回审');
  if(!canInspect(task,actor)) throw new HttpError(403,'仅独立检验员或管理员可发送回审');
  if(task.orderStatus==='完成'&&!task.repairRound) throw new HttpError(409,'已完结工单不能发送回审');
  if(!task.items.length) throw new HttpError(409,'没有可回审的维修项目');
  const current=task.technicianIds??(task.technicianId?[task.technicianId]:[]);
  // Completed projects retain historical owners after handover. Review must give
  // those owners access again before unlocking their work.
  // Legacy external contractors have no employee account; schedulers operate their review.
  const legacyContractor=task.executionMode==='outsourced'&&!task.contractorId;
  const owners=legacyContractor?[]:task.items.map(item=>item.responsibleId||(current.length===1?current[0]:undefined));
  for(const ownerId of owners) {
    const owner=people.find(person=>person.id===ownerId&&person.active&&person.shopId===task.shopId
      && (task.executionMode==='outsourced'?(hasRole(person,'outsourcing')||person.outsourcingRoleMember):hasRole(person,'technician')));
    if(!owner)throw new HttpError(409,'回审项目负责人已失效或未明确，请先核对人员，必要时检验完成后通过返工重新安排');
  }
  const next=structuredClone(task);
  if(!legacyContractor) {
    // Roster-only additions have no review work and must not block final submission.
    next.technicianIds=[...new Set(owners)];
    next.participantIds=[...new Set([...(task.participantIds||[]),...current])];
    next.technicianId=next.technicianIds[0];
    next.technicianName=next.technicianIds.map(id=>people.find(person=>person.id===id)?.name||id).join('、');
  }
  next.stage='回审';
  next.version+=1;
  for(const key of ['completedAt','completedBy','inspectorId','inspectorName','inspectionClaimedAt','submittedAt','submissionNote','workerPauses','workerSubmissions','rejectedItemIds']) delete next[key];
  for(const item of next.items) {
    item.status='维修中';
    for(const key of ['finishAt','finishedBy','inspectedBy','inspectorName','inspectedAt','rejectionReason']) delete item[key];
  }
  resolveRepairResponsibilities(next,people,{required:true});
  return next;
}
