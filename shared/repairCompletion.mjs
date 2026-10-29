// An active repair/review takes precedence over the original financial status.
export function isRepairCompleted(stage, orderStatus) {
  return stage ? stage === '维修完成' : ['待结算', '完成'].includes(orderStatus);
}
export function repairStatusLabel(stage, orderStatus) {
  if (isRepairCompleted(stage, orderStatus)) return '维修完成';
  return stage || orderStatus;
}
export function repairCategory(status) {
  return ['待结算', '完成', '维修完成'].includes(status) ? '已完成' : status;
}
