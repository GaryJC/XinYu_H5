import {validateNameplateNotification} from '../repositories/vehicleNameplateRepository.mjs';
import {isDispatchNotificationSuppressed} from '../domain/notificationPolicy.mjs';
import {validateDeferredNotification} from '../repositories/inspectionDeferredRepository.mjs';
import { hasRole } from "../../shared/roles.mjs";
import { validateSignatureReviewRecipient } from '../repositories/customerSignatureReviewRepository.mjs';
import { validateInspectionRecipient } from '../repositories/dispatchRepository.mjs';
import { pool } from '../database/pool.mjs';
import { currentPartsNotification } from '../repositories/partsRequirementRepository.mjs';
import { processSchedulerNotifications, validateSchedulerRecipient } from './schedulerNotifications.mjs';
import { processInspectionNotifications } from './inspectionNotifications.mjs';
import { notificationConfiguration,sendWorkNotification } from '../integrations/dingtalk/notifications.mjs';
import { claimNotification,finishNotification,notificationRecipient,validateAddedRepairRecipient } from '../repositories/dispatchNotificationRepository.mjs';
export async function processNotification({claim=claimNotification,finish=finishNotification,recipient=notificationRecipient,send=sendWorkNotification,validateParts=(row,user)=>currentPartsNotification(row,user,pool),validateInspection=validateInspectionRecipient,validateScheduler=validateSchedulerRecipient,validateAddedRepair=validateAddedRepairRecipient,validateNameplate=(row,user)=>validateNameplateNotification(row,user,pool),validateDeferred=(row,user)=>validateDeferredNotification(row,user,pool)}={}) {
  const row=await claim(); if(!row) return false;
  // Do not read recipients or invoke any remote integration for retired pushes.
  // Already-submitted history keeps its actual result and remains queryable.
  if(row.previous_status!=='pending') {
    await finish(row,{status:row.previous_status,error:row.error||''});return true;
  }
  if(isDispatchNotificationSuppressed(row.kind)) {
    await finish(row,{status:'suppressed',error:'',retryable:false});return true;
  }
  let result,partsNotification,deliveryUserId; let sendStarted=false;
  try {
    const user=await recipient(row.recipient_id);
    if(row.kind==='车辆铭牌已更新'&&!await validateNameplate(row,user)) result={status:'failed',error:'铭牌已再次更新或收件人已无仓管权限',retryable:false};
    else if(['检验项目待定','待定项目派工','待定维修已撤销','待定项目处理提醒'].includes(row.kind)&&!await validateDeferred(row,user)) result={status:'failed',error:'待定项目状态或接收人权限已变化',retryable:false};
    else if(row.kind==='需确认用户签字' && !await validateSignatureReviewRecipient(row,user)) result={status:'failed',error:'签字已确认或收件人已无权限',retryable:false};
    else if(['新增维修项目','追加维修派工'].includes(row.kind) && !await validateAddedRepair(row,user)) result={status:'failed',error:'项目进度、维修轮次或负责人已变化，旧追加维修通知已取消',retryable:false};
    else if(['待检验','维修已提检','回审已提交'].includes(row.kind) && !await validateInspection(row,user)) result={status:'failed',error:'任务状态、检验人或本店独立检验权限已变化，旧检验通知已取消',retryable:false};
    else if(row.kind==='无法接单' && !await validateScheduler(row,user)) result={status:'failed',error:'收件人已无本店调度权限',retryable:false};
    else if(['配件申请','配件申请已更新'].includes(row.kind) && (!user?.active || !hasRole(user, 'warehouse') || user.shopId!==row.payload.shopId)) result={status:'failed',error:'收件人已无本店仓管权限',retryable:false};
    else if(['配件申请','配件申请已更新','配件需求已调整','配件可领取','配件已出库'].includes(row.kind) && !(partsNotification=await validateParts(row,user))) result={status:'failed',error:'配件申请、进度或领取人已变化，旧配件通知已取消',retryable:false};
    else if(!user?.active) result={status:'failed',error:'收件人已停用',retryable:false};
    else {sendStarted=true;deliveryUserId=user.dingtalk_user_id;result=await send(partsNotification&&typeof partsNotification==='object'?partsNotification:row,user.dingtalk_user_id);}
  } catch { result=!sendStarted&&row.previous_status==='pending'?{status:'failed',error:'发送前校验失败，将重试',retryable:true}:{status:'unknown',error:'通知处理异常，需查询或核对平台结果'}; }
 if(sendStarted && deliveryUserId) result={...result,deliveryUserId};
  await finish(row,result); return true;
}
export function startDispatchNotifications() {
  const mode=notificationConfiguration();
  if(mode==='disabled') {console.log('Dispatch notifications disabled; tasks remain queued.');return async()=>{};}
  let stopped=false; let running;
  const tick=()=>{if(stopped || running) return; running=(async()=>{
    await processInspectionNotifications();
    await processSchedulerNotifications();
    for(let i=0;i<10 && !stopped;i++) if(!await processNotification()) break;
  })().catch(error=>console.error('Dispatch notification worker:',error.message)).finally(()=>{running=undefined;});};
  const timer=setInterval(tick,5000); timer.unref(); tick();
  return async()=>{stopped=true;clearInterval(timer);await running;};
}
