import {pool,transaction} from '../database/pool.mjs';
import {notificationConfiguration,sendWorkNotification,queryWorkNotification} from '../integrations/dingtalk/notifications.mjs';
import {vehicleTripMessageBody} from '../integrations/dingtalk/vehicleTripNotifications.mjs';
import {syncManagerRoster} from '../integrations/dingtalk/managerRoster.mjs';
import {tripNotificationRecipient,tripManagerFanout} from '../domain/vehicleTripNotifications.mjs';
import {claimTripResolution,queueTripRecipients,failTripResolution,claimTripDelivery,tripDeliveryContext,finishTripDelivery} from '../repositories/vehicleTripNotificationRepository.mjs';
export async function resolveTripRecipients({database=pool,runTransaction=transaction,sync=syncManagerRoster,env=process.env}={}) {
  const job=await claimTripResolution(database);if(!job)return false;
  try {
    const ids=tripManagerFanout(job.action)&&notificationConfiguration(env)==='dingtalk'?await sync(job.payload.shopId):undefined;
    await queueTripRecipients(job,ids,runTransaction);
  } catch(error) {await failTripResolution(job,error.message,database);}
  return true;
}
export async function processTripNotification({database=pool,claim=()=>claimTripDelivery(database),context=row=>tripDeliveryContext(row,database),finish=(row,result)=>finishTripDelivery(row,result,database),send=sendWorkNotification,query=queryWorkNotification,env=process.env}={}) {
  const row=await claim();if(!row)return false;
  let result,started=false;
  try {
    const {job,trip,user}=await context(row);
    const notification={...row,action:job?.action,payload:job?.payload};
    if(row.previous_status!=='pending')result=await query(notification,user?.dingtalk_user_id,{env});
    else if(user?.id!==row.recipient_id||!tripNotificationRecipient(job?.action,trip,user))result={status:'failed',error:'申请状态或接收人权限已变化，通知已取消',retryable:false};
    else {started=true;result=await send(notification,user.dingtalk_user_id,{env,buildMessage:vehicleTripMessageBody});}
  } catch {result=started||row.previous_status!=='pending'?{status:'unknown',error:'发送结果不确定，请核对钉钉记录'}:{status:'failed',error:'发送前校验失败，将重试',retryable:true};}
  await finish(row,result);return true;
}
export function startVehicleTripNotifications() {
  if(notificationConfiguration()==='disabled')return async()=>{};
  let running,stopped=false;
  const tick=()=>{if(running||stopped)return;running=(async()=>{
    for(let i=0;i<10&&!stopped;i++)if(!await resolveTripRecipients())break;
    for(let i=0;i<10&&!stopped;i++)if(!await processTripNotification())break;
  })().catch(e=>console.error('出车申请通知：',e.message)).finally(()=>{running=undefined;});};
  const timer=setInterval(tick,5000);timer.unref();tick();
  return async()=>{stopped=true;clearInterval(timer);await running;};
}
