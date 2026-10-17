import type { DispatchTask, PartsRequirement } from '../../../../shared/types';
export function partsStatus(parts?:PartsRequirement) {
  return !parts?'历史申请':parts.mode==='none'?'无需配件':parts.issuedAt?'已出库':parts.preparedAt?'待领取':'待备料';
}
export function canProcessParts(task:DispatchTask) {
  return Boolean(!task.needsReview && task.acceptedAt && ['待开工','维修中','暂停'].includes(task.stage) && task.partsRequirement && task.partsRequirement.mode!=='none' && !task.partsRequirement.issuedAt);
}
