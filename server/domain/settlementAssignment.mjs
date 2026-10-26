import {HttpError} from '../http/HttpError.mjs';

// Reopen only reassigned work; unchanged inspected items keep their recorded results.
export function prepareSettlementAssignment(next,input) {
  if(next.stage!=='维修完成')return;
  if(next.orderStatus!=='待结算'||next.executionMode==='outsourced')throw new HttpError(409,'仅待结算的内部或外派维修单可重新分配项目');
  const changed=next.items.filter(item=>input.repairItems?.some(row=>row.id===item.id&&row.responsibleId&&row.responsibleId!==item.responsibleId));
  const added=input.repairItems?.some(row=>row.id===undefined);
  if(!changed.length&&!added)throw new HttpError(409,'请重新分配项目负责人或新增维修项目');
  if(!input.reason?.trim())throw new HttpError(400,'请填写重新分配原因');
  next.participantIds=[...new Set([...(next.participantIds||[]),...changed.flatMap(item=>[item.responsibleId,item.startedBy,item.finishedBy]).filter(Boolean)])];
  for(const item of changed) {
    const row=input.repairItems.find(row=>row.id===item.id);
    if(row.name!==item.name)throw new HttpError(409,'已检验项目仅可重新分配负责人，不能同时修改名称');
    item.status='待开工';
    for(const key of ['startAt','startedBy','finishAt','finishedBy','inspectedAt','inspectedBy','inspectorName','rejectionReason'])delete item[key];
  }
  next.stage='维修中';next.orderStatus='维修中';next.settlementAssignment=true;
  for(const key of ['completedAt','completedBy','inspectorId','inspectorName','inspectionClaimedAt','submittedAt','submissionNote','workHours','workHoursRecordedBy','workHoursRecordedName','workHoursRecordedAt'])delete next[key];
}
