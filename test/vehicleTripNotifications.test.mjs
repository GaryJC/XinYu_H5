import test from 'node:test';
import assert from 'node:assert/strict';
import {tripNotificationRecipient,tripNotificationKinds} from '../server/domain/vehicleTripNotifications.mjs';
import {vehicleTripMessageBody} from '../server/integrations/dingtalk/vehicleTripNotifications.mjs';
import {sendWorkNotification,queryWorkNotification} from '../server/integrations/dingtalk/notifications.mjs';
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
const {processTripNotification}=await import('../server/workers/vehicleTripNotifications.mjs');
const {notificationNextState}=await import('../server/repositories/dispatchNotificationRepository.mjs');
const employee={id:'e',active:true,role:'employee',shopId:'s',dingtalk_user_id:'ding-e'};
const manager={...employee,id:'m',role:'manager',dingtalk_user_id:'ding-m'};
const trip={id:'trip-1',shopId:'s',status:'待审批',applicantId:'e',applicantName:'员工甲',approvedBy:'m',vehicle:{plate:'鲁B12345',brand:'大众',model:'捷达'},reason:'送配件',actorName:'甲'};
const env={DISPATCH_NOTIFICATION_MODE:'dingtalk',APP_ENV:'test',DINGTALK_AGENT_ID:'123',DINGTALK_APP_KEY:'test',DINGTALK_APP_SECRET:'secret',DINGTALK_CORP_ID:'ding-corp',DISPATCH_APP_URL:'https://repair.example/?dispatchOrder=old&workOrder=old&paperOrder=old&procurementTender=old&source=message'};
const states={create:'待审批',approve:'待出车',reject:'已驳回',cancel:'已取消',depart:'用车中',return:'已还车'};
test('each trip event targets only authorized people, excludes self approval and respects secondary roles',()=>{
 for(const action of Object.keys(states)) {
  const current={...trip,status:states[action]};
  const recipient=['approve','reject'].includes(action)?employee:manager;
  assert.equal(tripNotificationRecipient(action,current,recipient),true,action);
  for(const invalid of [{...recipient,active:false},{...recipient,shopId:'other'},{...employee,id:'stranger'}])assert.equal(tripNotificationRecipient(action,current,invalid),false,action);
  assert.equal(tripNotificationRecipient(action,{...current,status:'invalid'},recipient),false);
 }
 assert.equal(tripNotificationRecipient('create',trip,{...manager,id:'e'}),false);
 assert.equal(tripNotificationRecipient('create',trip,{...manager,role:'technician',roles:['technician','manager']}),true);
 assert.equal(tripNotificationRecipient('depart',{...trip,status:'用车中'},{...manager,id:'other-manager'}),false);
 assert.equal(tripNotificationRecipient('create',{...trip,status:'待出车'},manager),false);
});
test('all trip messages link to the exact request with enterprise context and readable status',()=>{
 for(const action of Object.keys(states)) {
  const body=vehicleTripMessageBody({action,payload:{...trip,status:states[action],rejectionReason:'车辆维修',departureAt:'2026-10-29T01:00:00Z',returnAt:'2026-10-29T02:00:00Z'}},'ding-e',env);
  const text=body.msg.markdown.text,url=new URL(text.match(/\[查看出车申请\]\(([^)]+)\)/)[1]);
  assert.equal(url.searchParams.get('vehicleTrip'),'trip-1');assert.equal(url.searchParams.get('corpid'),'ding-corp');assert.equal(url.searchParams.get('source'),'message');
  for(const key of ['dispatchOrder','workOrder','paperOrder','procurementTender'])assert.equal(url.searchParams.has(key),false);
  assert.equal(body.userid_list,'ding-e');assert.equal(body.to_all_user,false);assert.match(text,/申请人：员工甲/);assert.match(text,/用车事由：送配件/);
  assert.ok(body.msg.markdown.title.includes(tripNotificationKinds[action]));assert.doesNotMatch(text,/secret|预计完工|查看维修任务/);
  if(action==='reject')assert.match(text,/驳回原因：车辆维修/);
  if(action==='depart')assert.match(text,/09:00:00/);
  if(action==='return')assert.match(text,/10:00:00/);
 }
 const text=vehicleTripMessageBody({action:'create',payload:{...trip,reason:'[伪造](https://evil.example)\n# 标题'}},'ding-e',env).msg.markdown.text;
 assert.doesNotMatch(text,/\[伪造\]|\n# 标题/);
});
async function runWorker({row={},context={},...extra}={}) {
 let result,sends=0,queries=0;
 await processTripNotification({env,claim:async()=>({id:'n',recipient_id:'m',previous_status:'pending',attempts:1,polls:0,...row}),
  context:typeof context==='function'?context:async()=>({job:{action:'create',payload:trip},trip,user:manager,...context}),
  send:async(notification,recipient,options)=>{sends++;assert.equal(recipient,'ding-m');assert.equal(options.buildMessage,vehicleTripMessageBody);return {status:'accepted',taskId:'1'};},
  query:async()=>{queries++;return {status:'sent'};},finish:async(_,value)=>{result=value;},...extra});
 return {result,sends,queries};
}
test('trip worker sends current messages and cancels stale or unauthorized messages',async()=>{
 assert.deepEqual(await runWorker(),{result:{status:'accepted',taskId:'1'},sends:1,queries:0});
 for(const context of [{trip:{...trip,status:'待出车'}},{user:{...manager,active:false}},{user:{...manager,role:'employee'}},{user:{...manager,id:'another'}},{user:undefined}]) {
  const {result,sends}=await runWorker({context});assert.equal(sends,0);assert.equal(result.status,'failed');assert.equal(result.retryable,false);
 }
});
test('accepted or uncertain messages query the platform without sending again even if trip has moved on',async()=>{
 for(const previous_status of ['accepted','unknown']) {
  const result=await runWorker({row:{previous_status,task_id:'123'},context:{trip:{...trip,status:'已还车'}}});
  assert.deepEqual(result,{result:{status:'sent'},sends:0,queries:1});
 }
});
test('pre-send failures retry, ambiguous sends stop automatic resends',async()=>{
 const before=await runWorker({context:async()=>{throw new Error('database');}});
 assert.equal(before.result.retryable,true);assert.equal(notificationNextState({attempts:1},before.result).status,'pending');
 const after=await runWorker({send:async()=>{throw new Error('timeout');}});
 assert.equal(after.result.status,'unknown');assert.deepEqual(notificationNextState({attempts:1,polls:0},after.result),{status:'unknown',delay:null});
});
test('trip payload uses the real DingTalk adapter contract without network or real recipients',async()=>{
 let posted;
 const options={env,token:async()=>'test-token',buildMessage:vehicleTripMessageBody,fetcher:async(url,request)=>{posted=JSON.parse(request.body);return new Response(JSON.stringify({errcode:0,task_id:789}));}};
 const notice={id:'n',action:'approve',payload:{...trip,status:'待出车'}};
 const result=await sendWorkNotification(notice,'ding-e',options);
 assert.equal(result.status,'accepted');assert.equal(result.taskId,'789');assert.equal(posted.msg.markdown.title,'出车申请已批准 · 鲁B12345');
 const queried=await queryWorkNotification({...notice,task_id:'789'},'ding-e',{...options,fetcher:async()=>new Response(JSON.stringify({errcode:0,send_result:{unread_user_id_list:['ding-e']}}))});
 assert.equal(queried.status,'sent');
 const limited=await sendWorkNotification(notice,'ding-e',{...options,fetcher:async()=>new Response('{}',{status:429})});
 assert.equal(limited.retryable,true);assert.equal(notificationNextState({attempts:1},limited).status,'pending');assert.equal(notificationNextState({attempts:5},limited).status,'failed');
 assert.equal((await sendWorkNotification(notice,'',options)).retryable,false);
});
