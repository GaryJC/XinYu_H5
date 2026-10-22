import { hasRole } from "../../shared/roles.mjs";
import {pool,transaction} from '../database/pool.mjs';
import {notificationConfiguration,sendWorkNotification,queryWorkNotification} from '../integrations/dingtalk/notifications.mjs';
import {licenseExceptionMessageBody} from '../integrations/dingtalk/licenseExceptionNotifications.mjs';
import {syncManagerRoster} from '../integrations/dingtalk/managerRoster.mjs';
import {claimLicenseResolution,queueLicenseManagers,failLicenseResolution,claimLicenseDelivery,licenseDeliveryContext,finishLicenseDelivery} from '../repositories/vehicleLicenseNotificationRepository.mjs';
export async function resolveLicenseExceptionManagers({database=pool,runTransaction=transaction,sync=syncManagerRoster,env=process.env}={}) {
  const job=await claimLicenseResolution(database);if(!job)return false;
  try {
    const ids=notificationConfiguration(env)==='dingtalk'?await sync(job.payload.shopId):undefined;
    await queueLicenseManagers(job,ids,runTransaction);
  } catch(error) {await failLicenseResolution(job,error.message,database);}
  return true;
}
export async function processLicenseExceptionNotification({database=pool,send=sendWorkNotification,query=queryWorkNotification,env=process.env}={}) {
  const row=await claimLicenseDelivery(database);if(!row)return false;
  let result,started=false;
  try {
    const context=await licenseDeliveryContext(row,database);
    const notification={...row,payload:context?.payload,kind:'行驶证缺失备案'};
    if(row.previous_status!=='pending')result=await query(notification,context?.dingtalk_user_id,{env});
    else if(!context?.active||!hasRole(context, 'manager')||context.shop_id!==context.payload.shopId)result={status:'failed',error:'收件人已无本店管理员权限',retryable:false};
    else {started=true;result=await send(notification,context.dingtalk_user_id,{env,buildMessage:licenseExceptionMessageBody});}
  } catch {result=started||row.previous_status!=='pending'?{status:'unknown',error:'发送结果不确定，请核对钉钉记录'}:{status:'failed',error:'发送前校验失败',retryable:true};}
  await finishLicenseDelivery(row,result,database);return true;
}
export function startVehicleLicenseExceptionNotifications() {
  if(notificationConfiguration()==='disabled')return async()=>{};
  let running,stopped=false;
  const tick=()=>{if(running||stopped)return;running=(async()=>{await resolveLicenseExceptionManagers();for(let i=0;i<10&&!stopped;i++)if(!await processLicenseExceptionNotification())break;})().catch(e=>console.error('行驶证备案通知：',e.message)).finally(()=>{running=undefined;});};
  const timer=setInterval(tick,5000);timer.unref();tick();
  return async()=>{stopped=true;clearInterval(timer);await running;};
}
