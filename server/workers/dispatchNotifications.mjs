import { notificationConfiguration,sendWorkNotification,queryWorkNotification } from '../integrations/dingtalk/notifications.mjs';
import { claimNotification,finishNotification,notificationRecipient } from '../repositories/dispatchNotificationRepository.mjs';
export async function processNotification({claim=claimNotification,finish=finishNotification,recipient=notificationRecipient,send=sendWorkNotification,query=queryWorkNotification}={}) {
  const row=await claim(); if(!row) return false;
  let result;
  try {
    const user=await recipient(row.recipient_id);
    if(row.previous_status!=='pending') result=await query(row,user?.dingtalk_user_id);
    else if(!user?.active) result={status:'failed',error:'收件人已停用',retryable:false};
    else result=await send(row,user.dingtalk_user_id);
  } catch { result={status:'unknown',error:'通知处理异常，需查询或核对平台结果'}; }
  await finish(row,result); return true;
}
export function startDispatchNotifications() {
  const mode=notificationConfiguration();
  if(mode==='disabled') {console.log('Dispatch notifications disabled; tasks remain queued.');return async()=>{};}
  let stopped=false; let running;
  const tick=()=>{if(stopped || running) return; running=(async()=>{
    for(let i=0;i<10 && !stopped;i++) if(!await processNotification()) break;
  })().catch(error=>console.error('Dispatch notification worker:',error.message)).finally(()=>{running=undefined;});};
  const timer=setInterval(tick,5000); timer.unref(); tick();
  return async()=>{stopped=true;clearInterval(timer);await running;};
}
