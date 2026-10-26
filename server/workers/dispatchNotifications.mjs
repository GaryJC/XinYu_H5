import { hasRole } from "../../shared/roles.mjs";
import { validateSignatureReviewRecipient } from '../repositories/customerSignatureReviewRepository.mjs';
import { validateInspectionRecipient } from '../repositories/dispatchRepository.mjs';
import { pool } from '../database/pool.mjs';
import { validatePartsPickupNotification } from '../repositories/partsRequirementRepository.mjs';
import { processSchedulerNotifications, validateSchedulerRecipient } from './schedulerNotifications.mjs';
import { queueDueReminders, validateDueReminder } from './dueReminders.mjs';
import { processInspectionNotifications } from './inspectionNotifications.mjs';
import { notificationConfiguration,sendWorkNotification,queryWorkNotification } from '../integrations/dingtalk/notifications.mjs';
import { claimNotification,finishNotification,notificationRecipient,validateAddedRepairRecipient } from '../repositories/dispatchNotificationRepository.mjs';
export async function processNotification({claim=claimNotification,finish=finishNotification,recipient=notificationRecipient,send=sendWorkNotification,query=queryWorkNotification,validateParts=(row,user)=>validatePartsPickupNotification(row,user,pool),validateInspection=validateInspectionRecipient,validateDue=validateDueReminder,validateScheduler=validateSchedulerRecipient,validateAddedRepair=validateAddedRepairRecipient}={}) {
  const row=await claim(); if(!row) return false;
  let result; let sendStarted=false;
  try {
    const user=await recipient(row.recipient_id);
    if(row.previous_status!=='pending') result=await query(row,user?.dingtalk_user_id);
    else if(row.kind==='需确认用户签字' && !await validateSignatureReviewRecipient(row,user)) result={status:'failed',error:'签字已确认或收件人已无权限',retryable:false};
    else if(['新增维修项目','追加维修派工'].includes(row.kind) && !await validateAddedRepair(row,user)) result={status:'failed',error:'项目进度、维修轮次或负责人已变化，旧追加维修通知已取消',retryable:false};
    else if(row.kind==='待检验' && !await validateInspection(row,user)) result={status:'failed',error:'任务状态、检验人或本店独立检验权限已变化，旧检验通知已取消',retryable:false};
    else if(row.kind==='即将到期' && !await validateDue(row,user)) result={status:'failed',error:'工单状态、截止时间或责任人已变化，旧临期提醒已取消',retryable:false};
    else if(['无法接单','维修暂停','维修已提检','回审已提交'].includes(row.kind) && !await validateScheduler(row,user)) result={status:'failed',error:'收件人已无本店调度权限',retryable:false};
    else if(['配件申请','配件申请已更新'].includes(row.kind) && (!user?.active || !hasRole(user, 'warehouse') || user.shopId!==row.payload.shopId)) result={status:'failed',error:'收件人已无本店仓管权限',retryable:false};
    else if(['配件申请','配件申请已更新','配件需求已调整','配件可领取','配件已出库'].includes(row.kind) && !await validateParts(row,user)) result={status:'failed',error:'配件申请、进度或领取人已变化，旧配件通知已取消',retryable:false};
    else if(!user?.active) result={status:'failed',error:'收件人已停用',retryable:false};
    else {sendStarted=true;result=await send(row,user.dingtalk_user_id);}
  } catch { result=!sendStarted&&row.previous_status==='pending'?{status:'failed',error:'发送前校验失败，将重试',retryable:true}:{status:'unknown',error:'通知处理异常，需查询或核对平台结果'}; }
  await finish(row,result); return true;
}
export function startDispatchNotifications() {
  const mode=notificationConfiguration();
  if(mode==='disabled') {console.log('Dispatch notifications disabled; tasks remain queued.');return async()=>{};}
  let stopped=false; let running; let lastDueScan=0;
  const tick=()=>{if(stopped || running) return; running=(async()=>{
    if(Date.now()-lastDueScan>=60000) {await queueDueReminders();lastDueScan=Date.now();}
    await processSchedulerNotifications();
    await processInspectionNotifications();
    for(let i=0;i<10 && !stopped;i++) if(!await processNotification()) break;
  })().catch(error=>console.error('Dispatch notification worker:',error.message)).finally(()=>{running=undefined;});};
  const timer=setInterval(tick,5000); timer.unref(); tick();
  return async()=>{stopped=true;clearInterval(timer);await running;};
}
