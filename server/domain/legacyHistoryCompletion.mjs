const text = value => String(value ?? '').trim();
const plate = value => text(value).replace(/\s/g, '').toUpperCase();

// Historical imports may carry a detail-row reid. Match the unique internal
// header by dispatch number, document number, department and normalized plate.
export function historyCompletionReason(order, headers, cutoff) {
  if (!Number.isFinite(Date.parse(cutoff))) return '无有效的派工启用时间';
  if (!['已委托', '待派工'].includes(order.status)) return '不在待派工范围';
  if (order.has_activity) return '已有派工、维修、领料或返工记录';
  if (order.legacy_sync_status !== 'synced' || order.pending_sync) return '存在未完成同步';
  if (!text(order.dispatch_no) || !text(order.department_code) || !(Number(order.legacy_document_no)>0)) return '关联信息不完整';
  const internal = headers.filter(h => text(h.wd) === '');
  if (internal.length !== 1 || headers.length > 2 || headers.some(h => !['', '1'].includes(text(h.wd)))) return '内外单不唯一';
  const header = internal[0];
  if (headers.some(h => text(h.pgd) !== text(order.dispatch_no) || !plate(h.plate) || plate(h.plate) !== plate(order.vehicle_plate)
    || text(h.department) !== text(order.department_code) || Number(h.dh) !== Number(order.legacy_document_no))) return '派工号对应车辆、部门或内部单号不一致';
  if (headers.some(h => text(h.deleted) === '1')) return '润丰单据已删除';
  if (text(header.approved) !== '1') return '润丰内单未审核';
  if (text(header.marker).startsWith('H5:') && text(header.marker) !== `H5:${order.id}`) return '来源标记不一致';
  const arrival = text(header.arrival).replaceAll('.', '-');
  const cutoffDay = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai'}).format(new Date(cutoff));
  const createdBefore = Date.parse(order.created_at) < Date.parse(cutoff);
  const importedHistory = /^\d{4}-\d{2}-\d{2}$/.test(arrival) && Number.isFinite(Date.parse(arrival)) && arrival < cutoffDay;
  if (!createdBefore && !importedHistory) return '不属于启用派工前的历史单';
  return null;
}
