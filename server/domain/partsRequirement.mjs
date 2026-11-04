import {hasUnpreparedParts,canStartRepairWithParts} from '../../shared/repairProgress.mjs';
import { HttpError } from '../http/HttpError.mjs';
export function validatePartsRequirement(value) {
  if(!value || !['none','list','photo'].includes(value.mode)) throw new HttpError(400,'请登记所需配件，或选择无需配件');
  const items=value.items??[],photoIds=value.photoIds??[],referencePhotoIds=value.referencePhotoIds===undefined?[]:value.referencePhotoIds;
  if(!Array.isArray(items)||items.length>100||items.some(i=>!i||typeof i.name!=='string'||!i.name.trim()||i.name.length>200||typeof i.quantity!=='number'||!Number.isFinite(i.quantity)||i.quantity<=0||i.quantity>99999||typeof i.unit!=='string'||!i.unit.trim()||i.unit.length>20)) throw new HttpError(400,'请填写配件名称、有效数量和单位');
  if(!Array.isArray(photoIds)||photoIds.length>10||photoIds.some(id=>typeof id!=='string'||!id||id.length>200)||new Set(photoIds).size!==photoIds.length) throw new HttpError(400,'配件清单照片无效');
  if(!Array.isArray(referencePhotoIds)||referencePhotoIds.length>10||referencePhotoIds.some(id=>typeof id!=='string'||!id||id.length>200)||new Set(referencePhotoIds).size!==referencePhotoIds.length||value.mode==='none'&&referencePhotoIds.length)throw new HttpError(400,'配件照片无效，最多上传 10 张');
  if(value.mode==='none'&&(items.length||photoIds.length)||value.mode==='list'&&(!items.length||photoIds.length)||value.mode==='photo'&&(!photoIds.length||items.length)) throw new HttpError(400,'配件登记方式与内容不一致');
  return {mode:value.mode,items:items.map(i=>({name:i.name.trim(),quantity:i.quantity,unit:i.unit.trim()})),photoIds,...(referencePhotoIds.length?{referencePhotoIds:[...referencePhotoIds]}:{})};
}
export function beginPendingItems(next,actor,now,sharedPartsRequirement) {
  const pending=next.items.filter(item=>['待开工','待派工','待领料'].includes(item.status)
    && canStartRepairWithParts(next,item.responsibleId||next.technicianId,sharedPartsRequirement));
  if(!pending.length) {
    // Accepting a handover resumes existing progress without rewriting its history.
    if(canStartRepairWithParts(next,actor?.id,sharedPartsRequirement)&&next.items.some(item=>['维修中','待检验','已完工'].includes(item.status)))next.stage='维修中';
    return;
  }
  if(!actor?.id)throw new HttpError(409,'维修负责人未明确，请联系服务顾问核对后再开工');
  const starters=new Set();
  for(const item of pending) {
    const starter=next.executionMode==='outsourced'?actor.id:item.responsibleId||actor.id;
    item.status='维修中';item.startAt ||= now;item.startedBy=starter;delete item.finishAt;
    starters.add(starter);
    if(next.workerPauses?.[starter])next.workerPauses[starter].resumeStage='维修中';
  }
  if(!next.startHistoryUnknown)next.firstStartedAt ||= now;
  next.participantIds=[...new Set([...(next.participantIds||[]),...starters])];
  next.stage='维修中';
}

// Completion and material handover still require the complete request to be ready.
export function assertPartsIssued(task) {
  if(hasUnpreparedParts(task))
    throw new HttpError(409,'请等待仓管确认配件备齐后再提交完工或确认领料');
}

export function assertPartsReadyToStart(task,ownerId,sharedPartsRequirement) {
  if(!canStartRepairWithParts(task,ownerId,sharedPartsRequirement))
    throw new HttpError(409,task.executionMode==='outsourced'?'请等待仓管确认配件备齐后再开工':'请等待仓管确认配件备齐（至少一项）后再开工');
}

// Match each handled line once; audit fields always come from the saved request.
export function preserveHandledParts(previous, requirement) {
  const handled=previous?.items?.filter(item=>item.preparedAt||item.issuedAt)||[];
  if(!handled.length||previous.preparedAt||previous.issuedAt)return requirement;
  const available=new Set(requirement.items.map((_,index)=>index));
  for(const item of handled) {
    const index=[...available].find(index=>{
      const row=requirement.items[index];
      return row.name===item.name&&row.quantity===item.quantity&&row.unit===item.unit;
    });
    if(requirement.mode!=='list'||index===undefined)throw new HttpError(409,'已备齐或已出库的配件不可修改或删除，请仅编辑待备料配件');
    requirement.items[index]={...item};available.delete(index);
  }
  return requirement;
}
