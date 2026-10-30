import {procurementNotificationRole} from '../domain/procurementNotificationAudience.mjs';
import { hasAnyRole } from "../../shared/roles.mjs";
import { pool } from '../database/pool.mjs';
import { freezeDue } from '../repositories/procurementRepository.mjs';
import * as repository from '../repositories/procurementNotificationRepository.mjs';
import { notificationRecipient } from '../repositories/dispatchNotificationRepository.mjs';
import { notificationConfiguration,sendWorkNotification,queryWorkNotification } from '../integrations/dingtalk/notifications.mjs';
import { procurementMessageBody } from '../integrations/dingtalk/procurementNotifications.mjs';
import { syncManagerRoster } from '../integrations/dingtalk/managerRoster.mjs';
export async function resolveProcurementRecipients({claim=repository.claimResolution,resolve=repository.resolveRecipients,fail=repository.failResolution,sync=syncManagerRoster,env=process.env}={}) {
  const job=await claim();if(!job)return false;
  try {const ids=notificationConfiguration(env)==='dingtalk'?await sync(job.shop_id,{roleKeys:[procurementNotificationRole(job.payload)]}):undefined;await resolve(job,ids);}
  catch(e){await fail(job,e.message||'接收人同步失败');}return true;
}
export async function deliverProcurementNotification({claim=repository.claimDelivery,finish=repository.finishDelivery,recipient=notificationRecipient,send=sendWorkNotification,query=queryWorkNotification,env=process.env}={}) {
  const row=await claim();if(!row)return false;
  let result,started=false;
  try {
    const user=await recipient(row.recipient_id);
    if(row.previous_status!=='pending')result=await query(row,user?.dingtalk_user_id,{env});
    else if(!user?.active||user.shopId!==row.shop_id||!hasAnyRole(user, [procurementNotificationRole(row.payload)]))result={status:'failed',error:'收件人不属于本次通知的接收岗位',retryable:false};
    else {started=true;result=await send(row,user.dingtalk_user_id,{env,buildMessage:procurementMessageBody});}
  }catch{result=started||row.previous_status!=='pending'?{status:'unknown',error:'发送结果不确定，请核对钉钉记录'}:{status:'failed',error:'发送前校验失败',retryable:true};}
  await finish(row,result);return true;
}
export function startProcurementWorker() {
  const mode=notificationConfiguration();let running,stopped=false,lastCleanup=0;
  const tick=()=>{if(running||stopped)return;running=(async()=>{
    await freezeDue(pool);
    if(Date.now()-lastCleanup>3600000){await repository.cleanupPortal();lastCleanup=Date.now();}
    if(mode!=='disabled'){await resolveProcurementRecipients();for(let i=0;i<10&&!stopped;i++)if(!await deliverProcurementNotification())break;}
  })().catch(e=>console.error('配件竞价后台任务：',e.message)).finally(()=>{running=undefined;});};
  const timer=setInterval(tick,5000);timer.unref();tick();
  return async()=>{stopped=true;clearInterval(timer);await running;};
}
