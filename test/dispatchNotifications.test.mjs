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
