export function warehouseRequests(tasks) {
  return tasks.flatMap(task => [...(task.partsRequirement ? [task] : []), ...(task.partsRequests || []).map(parts => ({...task, partsRequirement: parts}))]);
}
export function partsStatus(parts) {
  return !parts?'历史申请':parts.mode==='none'?'无需配件':parts.issuedAt||parts.preparedAt?'备料完成':parts.items.some(i=>i.issuedAt||i.preparedAt)?'部分备齐':'待备料';
}
export function canProcessParts(task) {
  return Boolean(!task.needsReview && task.acceptedAt && ['待开工','维修中','暂停','回审'].includes(task.stage) && task.partsRequirement && task.partsRequirement.mode!=='none' && !task.partsRequirement.issuedAt && !task.partsRequirement.preparedAt);
}
export function matchesPartsStatus(task,status) {
  return (['待备料','部分备齐'].includes(status)?canProcessParts(task):true) && partsStatus(task.partsRequirement)===status;
}
export function sortWarehouseRequests(tasks,order) {
  const time=task=>Date.parse(task.partsRequirement?.recordedAt||'');
  return [...tasks].sort((a,b)=>{
    const left=time(a),right=time(b);
    if(!Number.isFinite(left))return Number.isFinite(right)?1:0;
    if(!Number.isFinite(right))return -1;
    return (left-right)*(order==='newest'?-1:1) || a.orderId.localeCompare(b.orderId) || (a.partsRequirement?.ownerId||'').localeCompare(b.partsRequirement?.ownerId||'');
  });
}
