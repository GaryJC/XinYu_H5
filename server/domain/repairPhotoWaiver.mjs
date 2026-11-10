import {createHash} from 'node:crypto';
import {hasAnyRole} from '../../shared/roles.mjs';
import {canRequestPhotoWaiver,currentPhotoWaiver,repairPhotoWaiverScope} from '../../shared/repairPhotoWaiver.mjs';
import {HttpError} from '../http/HttpError.mjs';
export const photoWaiverActions=['request-photo-waiver','approve-photo-waiver','reject-photo-waiver'];
export function validatePhotoWaiverRequest(input) {
 if(!photoWaiverActions.includes(input.action)) {
  if(input.waiverId!==undefined)throw new HttpError(400,'审批编号仅用于无维修照片审批');
  return;
 }
 if(Object.keys(input).some(key=>!['action','requestId','expectedVersion','reason','waiverId'].includes(key)))throw new HttpError(400,'无维修照片审批不能同时修改其他内容');
 if(input.action!=='request-photo-waiver'&&(typeof input.waiverId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(input.waiverId)))throw new HttpError(400,'请选择有效的无维修照片申请');
 if(input.action==='request-photo-waiver'&&input.waiverId!==undefined)throw new HttpError(400,'申请编号由请求生成');
 if(input.action!=='approve-photo-waiver'&&(typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>1000))throw new HttpError(400,'请填写原因，不超过1000字');
}
export function applyPhotoWaiver(task,input,actor,people,now) {
 const next=structuredClone(task);
 const entries=next.repairPhotoWaivers||[];
 if(input.action==='request-photo-waiver') {
  if(!canRequestPhotoWaiver(task,actor))throw new HttpError(403,'仅当前维修经办人可在提交完工前申请');
  const previous=currentPhotoWaiver(task,actor.id);
  if(previous&&['pending','approved'].includes(previous.status))throw new HttpError(409,'本次申请已提交，请查看审批结果');
  const id=createHash('sha256').update(JSON.stringify([task.orderId,actor.id,input.requestId])).digest('hex');
  const entry={id,applicantId:actor.id,applicantName:actor.name,reason:input.reason.trim(),requestedAt:now,
   repairRound:task.repairRound||0,scope:repairPhotoWaiverScope(task,actor.id),status:'pending'};
  next.repairPhotoWaivers=[...entries.filter(row=>row.applicantId!==actor.id),entry];
 } else {
  if(!hasAnyRole(actor,['manager','advisor']))throw new HttpError(403,'仅本店管理员或服务顾问可审批');
  const entry=entries.find(row=>row.id===input.waiverId);
  if(entries.filter(row=>row.id===input.waiverId).length>1)throw new HttpError(409,'申请编号重复，无法确定审批对象，请联系管理员核对');
  if(!entry)throw new HttpError(409,'申请已失效，请刷新');
  if(entry.applicantId===actor.id)throw new HttpError(403,'不能审批自己的申请');
  const applicant=people.find(person=>person.id===entry.applicantId);
  if(entry.status!=='pending'||currentPhotoWaiver(task,entry.applicantId)?.id!==entry.id)throw new HttpError(409,'申请已处理或项目、轮次已变化，请刷新');
  // Revoked/disabled applicants cannot be approved, but an approver can still
  // reject their obsolete request instead of leaving it permanently pending.
  if(input.action==='approve-photo-waiver'&&!canRequestPhotoWaiver(task,applicant))throw new HttpError(409,'申请人已提交完工或权限已变化，不能通过审批');
  Object.assign(entry,{status:input.action==='approve-photo-waiver'?'approved':'rejected',decidedBy:actor.id,decidedName:actor.name,decidedAt:now,decisionReason:input.reason?.trim()||''});
  next.repairPhotoWaivers=entries;
 }
 next.version=task.version+1;
 return next;
}
