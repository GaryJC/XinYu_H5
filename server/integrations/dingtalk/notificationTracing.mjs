import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {tripNotificationKinds} from '../../domain/vehicleTripNotifications.mjs';
export function notificationTraceKind(source,notification) {
 if(source==='vehicle-trip')return tripNotificationKinds[notification.action]||'车辆通知';
 if(source==='vehicle-insurance')return '车辆保险提醒';
 if(source==='license-exception')return '行驶证缺失备案';
 if(source==='procurement') {
  const title=String(notification.payload?.title||'');
  for(const kind of ['已提交报价','已放弃报价'])if(title.includes(kind+'：'))return '供应商'+kind;
  return title.split('：')[0].slice(0,80)||'采购通知';
 }
 return String(notification.kind||'派工通知').slice(0,80);
}
// Real calls are traced in development and production; isolated tests inject a recorder.
export async function tracedNotificationFetch(url,request,{fetcher,env,source='dispatch',notification,operation,recorder,log=console.info}) {
 const enabled=recorder||env.APP_ENV!=='test';
 if(!enabled)return fetcher(url,request);
 const id=randomUUID(),context={id,source,operation,notificationId:String(notification.id),kind:notificationTraceKind(source,notification)};
 let persistence=recorder;
 let saved=false;
 try {
  if(!persistence){
   const [{pool},repository]=await Promise.all([import('../../database/pool.mjs'),import('../../repositories/notificationUsageRepository.mjs')]);
   persistence={start:c=>repository.startNotificationTrace(pool,c),finish:(i,r)=>repository.finishNotificationTrace(pool,i,r)};
  }
  await persistence.start(context);saved=true;
 }catch {console.error('[dingtalk-trace-write-failed]',{traceId:id,phase:'start'});}
 log('[dingtalk-call]',JSON.stringify({...context,phase:'start',persisted:saved}));
 const started=performance.now();let response,error;
 try {response=await fetcher(url,request);return response;}catch(e){error=e;throw e;}
 finally {
  let data;try {data=response?await response.clone().json():undefined;}catch{}
  const apiCode=data?.errcode===undefined?null:String(data.errcode).slice(0,40);
  const taskId=operation==='query'?notification.task_id:data?.task_id;
  const result={outcome:error?'transport-unknown':response?.ok&&data?.errcode===0?'ok':response?.ok&&apiCode===null?'response-unknown':'rejected',httpStatus:response?.status,apiCode,durationMs:Math.round(performance.now()-started),taskId:taskId==null?null:String(taskId).slice(0,150)};
  if(saved)try{await persistence.finish(id,result);}catch{console.error('[dingtalk-trace-write-failed]',{traceId:id,phase:'finish'});}
  log('[dingtalk-call]',JSON.stringify({traceId:id,phase:'finish',...result}));
 }
}
