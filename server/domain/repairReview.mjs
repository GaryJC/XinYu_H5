import {HttpError} from '../http/HttpError.mjs';

export function sendReview(task,actor,canInspect) {
  if(!['待检验','维修完成'].includes(task.stage)) throw new HttpError(409,'仅待检验或已检验的任务可发送回审');
  if(!canInspect(task,actor)) throw new HttpError(403,'仅独立检验员或管理员可发送回审');
  if(task.orderStatus==='完成'&&!task.repairRound) throw new HttpError(409,'已完结工单不能发送回审');
  if(!task.items.length) throw new HttpError(409,'没有可回审的维修项目');
  const next=structuredClone(task);
  next.stage='回审';
  next.version+=1;
  for(const key of ['completedAt','completedBy','inspectorId','inspectorName','inspectionClaimedAt','submittedAt','submissionNote','workerSubmissions','rejectedItemIds']) delete next[key];
  for(const item of next.items) {
    item.status='维修中';
    for(const key of ['finishAt','finishedBy','inspectedBy','inspectorName','inspectedAt','rejectionReason']) delete item[key];
  }
  return next;
}
