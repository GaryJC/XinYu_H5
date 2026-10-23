import { HttpError } from '../http/HttpError.mjs';
export const pendingName = name => `【待定】${name.replace(/^(?:【待定】)+/, '')}`;
export function validatePendingText(value, label, max = 200) {
 if(typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new HttpError(400, `${label}不能为空且不得超过 ${max} 字`);
 return value.trim();
}
export function pendingLegacyItems(items = []) {
 return items.filter(p => p.state !== 'declined' && !p.scheduled).map(p => ({id:p.itemId,name:pendingName(p.name),laborFee:0,owner:'待派工',status:'待派工',pendingConfirmation:true}));
}
export function mergePendingWriteback(items, pending = []) {
 const result = new Map(items.map(i => [i.id, {...i}]));
 for(const p of pending) {
  if(p.state === 'declined') {result.delete(p.itemId);continue;}
  const item = result.get(p.itemId);
  if(item?.status === '已完工' && p.state === 'approved') continue;
  result.set(p.itemId, {...item,id:p.itemId,name:pendingName(p.name),pendingConfirmation:true});
 }
 return [...result.values()];
}
