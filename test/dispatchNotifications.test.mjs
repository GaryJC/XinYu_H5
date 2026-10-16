import test from 'node:test';
import assert from 'node:assert/strict';
import {sendWorkNotification,queryWorkNotification,messageBody,notificationConfiguration} from '../server/integrations/dingtalk/notifications.mjs';
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
const {notificationNextState}=await import('../server/repositories/dispatchNotificationRepository.mjs');
const {processNotification}=await import('../server/workers/dispatchNotifications.mjs');
const env={DISPATCH_NOTIFICATION_MODE:'dingtalk',APP_ENV:'test',DINGTALK_AGENT_ID:'123',DINGTALK_APP_KEY:'test',DINGTALK_APP_SECRET:'test',DISPATCH_APP_URL:'https://repair.example/app'};
const notification={id:'n',payload:{orderId:'WT-1',plate:'鲁B12345',summary:'制动维修',dueAt:'2026-09-11T10:00:00Z'},kind:'新派工'};
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const options=fetcher=>({env,fetcher,token:async()=>'test-token'});

test('notification links use internal order ID and never expose credentials',()=>{
  const body=messageBody(notification,'worker',env);
  assert.equal(new URL(body.msg.markdown.text.match(/\[查看维修任务\]\(([^)]+)\)/)[1]).searchParams.get('dispatchOrder'),'WT-1');
  assert.equal(body.to_all_user,false);assert.equal(body.userid_list,'worker');
  assert.doesNotMatch(JSON.stringify(body),/test-token|APP_SECRET/);
  assert.throws(()=>notificationConfiguration({...env,APP_ENV:'production',DISPATCH_NOTIFICATION_MODE:'mock'}));
  assert.equal(notificationConfiguration({...env,DISPATCH_APP_URL:'http://120.26.195.38/'}),'dingtalk');
  assert.throws(()=>notificationConfiguration({...env,DISPATCH_APP_URL:'ftp://120.26.195.38/'}));
  assert.throws(()=>notificationConfiguration({...env,DISPATCH_APP_URL:'http://user:password@120.26.195.38/'}));
});
test('notification entry preserves enterprise context and task across HTTP IP links',()=>{
  const linkFor=config=>new URL(messageBody(notification,'worker',config).msg.markdown.text.match(/\[查看维修任务\]\(([^)]+)\)/)[1]);
  const config={...env,DISPATCH_APP_URL:'http://120.26.195.38:8788/?corpid=$CORPID$&source=notification',DINGTALK_CORP_ID:'ding-enterprise'};
  const link=linkFor(config);
  assert.equal(link.origin,'http://120.26.195.38:8788');
  assert.equal(link.searchParams.get('corpid'),'ding-enterprise');
  assert.equal(link.searchParams.get('dispatchOrder'),'WT-1');
  assert.equal(link.searchParams.get('source'),'notification');
  assert.equal(linkFor({...config,DINGTALK_CORP_ID:undefined,VITE_DINGTALK_CORP_ID:'ding-fallback'}).searchParams.get('corpid'),'ding-fallback');
  assert.equal(linkFor({...env,DISPATCH_APP_URL:'https://repair.example/?corpid=ding-explicit'}).searchParams.get('corpid'),'ding-explicit');
});
test('async acceptance is distinct from successful sending and worker acceptance',async()=>{
  const result=await sendWorkNotification(notification,'worker',options(async()=>response({errcode:0,task_id:99})));
  assert.deepEqual(result,{status:'accepted',taskId:'99'});
  const confirmed=await queryWorkNotification({...notification,task_id:'99'},'worker',options(async()=>response({errcode:0,send_result:{unread_user_id_list:['worker']}})));
  assert.equal(confirmed.status,'sent');
});
test('network interruption and 5xx results never trigger blind resend',async()=>{
  for(const fetcher of [async()=>{throw new Error('network');},async()=>response({},502)]){
    const result=await sendWorkNotification(notification,'worker',options(fetcher));
    assert.equal(result.status,'unknown');assert.deepEqual(notificationNextState({attempts:1,polls:0},result),{status:'unknown',delay:null});
  }
});
test('explicit transient failure retries with a bound and queries have a separate bound',async()=>{
  const result=await sendWorkNotification(notification,'worker',options(async()=>response({},429)));
  assert.equal(result.retryable,true);assert.equal(notificationNextState({attempts:1},result).status,'pending');
  assert.equal(notificationNextState({attempts:5},result).status,'failed');
  assert.equal(notificationNextState({attempts:1,polls:20,task_id:'99'},{status:'accepted'}).delay,null);
  assert.equal(notificationNextState({attempts:1,polls:20,task_id:'99'},{status:'accepted'}).status,'unknown');
});
test('unknown task with platform ID is queried after restart instead of resent',async()=>{
  const row={...notification,previous_status:'unknown',task_id:'99',recipient_id:'u'};
  let sent=0,queried=0,finished;
  await processNotification({claim:async()=>row,recipient:async()=>({active:true,dingtalk_user_id:'worker'}),send:async()=>{sent++;},query:async()=>{queried++;return {status:'sent'};},finish:async(_row,result)=>{finished=result;}});
  assert.equal(sent,0);assert.equal(queried,1);assert.equal(finished.status,'sent');
});
test('inactive employee receives no new notification; malformed result remains unknown',async()=>{
  let sends=0,finished;
  await processNotification({claim:async()=>({...notification,previous_status:'pending'}),recipient:async()=>({active:false}),send:async()=>{sends++;},finish:async(_,result)=>{finished=result;}});
  assert.equal(sends,0);assert.equal(finished.status,'failed');
  assert.equal((await queryWorkNotification({...notification,task_id:'99'},'worker',options(async()=>response({errcode:0})))).status,'unknown');
});

test('obsolete due reminders are never sent and pre-send validation failures can retry safely',async()=>{
 const row={...notification,order_id:'WT-1',recipient_id:'t',kind:'即将到期',previous_status:'pending'};
 let sends=0,finished;
 const dependencies={claim:async()=>row,recipient:async()=>({active:true,role:'technician',id:'t'}),send:async()=>{sends++;return {status:'sent'};},finish:async(_,result)=>{finished=result;}};
 await processNotification({...dependencies,validateDue:async()=>false});assert.equal(sends,0);assert.equal(finished.status,'failed');assert.equal(finished.retryable,false);
 await processNotification({...dependencies,validateDue:async()=>{throw new Error('db unavailable');}});assert.equal(sends,0);assert.equal(finished.retryable,true);
 await processNotification({...dependencies,validateDue:async()=>true});assert.equal(sends,1);
});
test('scheduler notices include operator, reason and due reminders include a clear instruction',()=>{
 const text=messageBody({...notification,kind:'维修暂停',payload:{...notification.payload,actorName:'维修工甲',reason:'待配件：缺少滤芯'}},'scheduler',env).msg.markdown.text;
 assert.match(text,/操作人：维修工甲/);assert.match(text,/待配件：缺少滤芯/);
 assert.match(messageBody({...notification,kind:'即将到期',payload:{...notification.payload,notice:'工单将在1小时内到期，请尽快处理。'}},'t',env).msg.markdown.text,/请尽快处理/);
});

test('scheduler fanout checks role and store again before sending',async()=>{
 const {validateSchedulerRecipient}=await import('../server/workers/schedulerNotifications.mjs');
 const database={query:async()=>({rows:[{shop_id:'s'}]})};
 assert.equal(await validateSchedulerRecipient({order_id:'o'},{active:true,role:'advisor',shopId:'s'},{database}),true);
 assert.equal(await validateSchedulerRecipient({order_id:'o'},{active:true,role:'manager',shopId:'other'},{database}),false);
 let sends=0,result;
 await processNotification({claim:async()=>({...notification,kind:'维修暂停',previous_status:'pending'}),recipient:async()=>({active:true,role:'advisor',shopId:'other'}),validateScheduler:async()=>false,send:async()=>sends++,finish:async(_,r)=>{result=r;}});
 assert.equal(sends,0);assert.equal(result.retryable,false);
});

test('parts notifications reject recipients who lost warehouse or shop membership',async()=>{
 for(const user of [{active:true,role:'technician',shopId:'s'},{active:true,role:'warehouse',shopId:'other'},{active:false,role:'warehouse',shopId:'s'}]) {
   let result,sent=false;
   await processNotification({claim:async()=>({id:'parts',kind:'配件申请',previous_status:'pending',recipient_id:'w',payload:{shopId:'s'}}),recipient:async()=>user,send:async()=>{sent=true;},finish:async(_row,value)=>{result=value;}});
   assert.equal(sent,false);assert.equal(result.status,'failed');
 }
});
