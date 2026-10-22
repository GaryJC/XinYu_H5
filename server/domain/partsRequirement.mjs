import { HttpError } from '../http/HttpError.mjs';
export function validatePartsRequirement(value) {
  if(!value || !['none','list','photo'].includes(value.mode)) throw new HttpError(400,'请登记所需配件，或选择无需配件');
  const items=value.items??[],photoIds=value.photoIds??[];
  if(!Array.isArray(items)||items.length>100||items.some(i=>!i||typeof i.name!=='string'||!i.name.trim()||i.name.length>200||typeof i.quantity!=='number'||!Number.isFinite(i.quantity)||i.quantity<=0||i.quantity>99999||typeof i.unit!=='string'||!i.unit.trim()||i.unit.length>20)) throw new HttpError(400,'请填写配件名称、有效数量和单位');
  if(!Array.isArray(photoIds)||photoIds.length>10||photoIds.some(id=>typeof id!=='string'||!id||id.length>200)||new Set(photoIds).size!==photoIds.length) throw new HttpError(400,'配件清单照片无效');
  if(value.mode==='none'&&(items.length||photoIds.length)||value.mode==='list'&&(!items.length||photoIds.length)||value.mode==='photo'&&(!photoIds.length||items.length)) throw new HttpError(400,'配件登记方式与内容不一致');
  return {mode:value.mode,items:items.map(i=>({name:i.name.trim(),quantity:i.quantity,unit:i.unit.trim()})),photoIds};
}
export function beginPendingItems(next,actor,now) {
  if(!actor?.id)throw new HttpError(409,'维修负责人未明确，请联系服务顾问核对后再开工');
  for(const item of next.items) if(['待开工','待派工','待领料'].includes(item.status)) {
    item.status='维修中';item.startAt ||= now;item.startedBy=actor.id;delete item.finishAt;
  }
  if(!next.startHistoryUnknown)next.firstStartedAt ||= now;
  next.participantIds=[...new Set([...(next.participantIds||[]),actor.id])];
  next.stage='维修中';
}

// Preserve legacy tasks; current requests must be issued before starting or completing.
export function assertPartsIssued(task) {
  if(task.partsRequirement && task.partsRequirement.mode!=='none' && !task.partsRequirement.issuedAt && !task.partsRequirement.preparedAt)
    throw new HttpError(409,'请等待仓管确认配件备齐后再开工或提交完工');
}
