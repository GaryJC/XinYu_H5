export function pendingRepairScheduleBlock(stage) {
  if(stage==='待检验')return '请先完成当前检验，再安排追加维修';
  if(['草稿','待客户签字','待处理纸质委托书'].includes(stage))return '请先完成客户签字，再安排追加维修';
  return undefined;
}
