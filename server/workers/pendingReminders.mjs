import {pool} from '../database/pool.mjs';
import {notificationConfiguration,sendWorkNotification} from '../integrations/dingtalk/notifications.mjs';
import {pendingMessageBody} from '../integrations/dingtalk/pendingReminders.mjs';
import {isBusinessTime,businessMinutesBetween} from '../domain/pendingReminders.mjs';
import {pendingTraceRecorder,projectPendingEvents,queuePendingReminders,claimPendingDigest,sealPendingDigest,pendingDeliveryContext,finishPendingDelivery} from '../repositories/pendingReminderRepository.mjs';
export async function deliverPendingDigest({database=pool,send=sendWorkNotification,env=process.env,claim=claimPendingDigest,seal=rows=>sealPendingDigest(database,rows),context=row=>pendingDeliveryContext(database,row),finish=(row,result)=>finishPendingDelivery(database,row,result)}={}){
 const rows=await claim();if(!rows.length)return false;
 const valid=[];let started=false;
 try{
  for(const row of rows){const value=await context(row);if(!value.user?.dingtalk_user_id){await finish(row,{status:'cancelled',error:'事项已处理、岗位变化或无钉钉账号'});continue;}valid.push({row,...value});}
  if(!valid.length)return true;
  const grouped=new Map();
  for(const v of valid){const key=`${v.subject.source_key}:${v.subject.target_id}:${v.slot.kind}`,item={kind:v.slot.kind,title:v.slot.title,level:v.row.level,error:v.slot.error,waitingMinutes:Math.floor(businessMinutesBetween(v.subject.entered_at))};const previous=grouped.get(key);if(previous){item.level=Math.max(previous.level,item.level);item.waitingMinutes=Math.max(previous.waitingMinutes,item.waitingMinutes);}grouped.set(key,item);}
  const first=valid[0],notification={id:first.row.id,kind:'待办超时提醒',payload:{items:[...grouped.values()]}};
  const recorder=pendingTraceRecorder(database,first);
  if(!await seal(valid.map(v=>v.row))){for(const row of rows)await finish(row,{status:'pending',error:'准备租约已到期，稍后重新校验'});return true;}
  started=true;const result=await send(notification,first.user.dingtalk_user_id,{env,buildMessage:pendingMessageBody,source:'pending-reminder',recorder:env.APP_ENV==='test'?undefined:recorder});
  for(const v of valid)await finish(v.row,result);
 }catch{
  for(const row of rows)await finish(row,{status:started?'unknown':'pending',error:started?'发送结果不确定，不自动重发':'发送前校验失败，稍后重试'});
 }
 return true;
}
export function startPendingReminders(){
 let running,stopped=false,lastScan=0;
 const tick=()=>{if(running||stopped)return;running=(async()=>{
  // Projection also runs with delivery disabled, so UI state never depends on DingTalk.
  let n;for(let i=0;i<10&&!stopped;i++){n=await projectPendingEvents();if(n<100)break;}
  if(n===100||!isBusinessTime()||notificationConfiguration()==='disabled')return;
  if(Date.now()-lastScan>=300000){
   let queued;for(let i=0;i<10&&!stopped;i++){queued=await queuePendingReminders();if(queued<100)break;}
   if(queued===100)return; // Finish the due backlog before digesting, including one daily summary per recipient.
   lastScan=Date.now();
  }
  for(let i=0;i<10&&!stopped&&isBusinessTime();i++)if(!await deliverPendingDigest())break;
 })().catch(e=>console.error('待办提醒：',e.message)).finally(()=>{running=undefined;});};
 const timer=setInterval(tick,30000);timer.unref();tick();return async()=>{stopped=true;clearInterval(timer);await running;};
}
