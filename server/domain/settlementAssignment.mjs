import {HttpError} from '../http/HttpError.mjs';

// Adding work reopens the order, never the already inspected projects.
export function prepareSettlementAssignment(next,input) {
  if(next.stage!=='维修完成')return;
  if(next.orderStatus!=='待结算'||next.executionMode==='outsourced')throw new HttpError(409,'仅待结算的内部或外派维修单可新增并分配项目');
  for(const item of next.items) {
    const row=input.repairItems?.find(row=>row.id===item.id);
    if(!row||row.name!==item.name||row.responsibleId!==undefined&&row.responsibleId!==item.responsibleId)
      throw new HttpError(409,'已检验项目不可修改、删除或重新分配负责人，只能新增项目并分配');
  }
  if(!input.repairItems?.some(row=>row.id===undefined))throw new HttpError(409,'请新增维修项目并分配负责人');
  next.stage='维修中';next.orderStatus='维修中';next.settlementAssignment=true;
  for(const key of ['completedAt','completedBy','inspectorId','inspectorName','inspectionClaimedAt','submittedAt','submissionNote','workHours','workHoursRecordedBy','workHoursRecordedName','workHoursRecordedAt'])delete next[key];
}
