import test from 'node:test';
import assert from 'node:assert/strict';
import {tracedNotificationFetch,notificationTraceKind} from '../server/integrations/dingtalk/notificationTracing.mjs';
import {sendWorkNotification,queryWorkNotification} from '../server/integrations/dingtalk/notifications.mjs';
const env={APP_ENV:'test',DISPATCH_NOTIFICATION_MODE:'dingtalk',DINGTALK_AGENT_ID:'1',DINGTALK_APP_KEY:'a',DINGTALK_APP_SECRET:'secret',DISPATCH_APP_URL:'https://example.test'};
test('each actual send/query gets its own trace; no payload or credentials enter logs',async()=>{
 const starts=[],ends=[],logs=[];let calls=0;
 const options={env,token:async()=>'secret-token',log:(...r)=>logs.push(r),recorder:{start:async c=>starts.push(c),finish:async(id,r)=>ends.push({id,...r})},fetcher:async()=>{calls++;return new Response(JSON.stringify({errcode:0,task_id:55,send_result:{unread_user_id_list:['secret-user']}}));}};
 const n={id:'notice',kind:'新派工',payload:{orderId:'o',summary:'customer private'}};
 assert.equal((await sendWorkNotification(n,'secret-user',options)).status,'accepted');
 assert.equal((await queryWorkNotification({...n,task_id:'55'},'secret-user',options)).status,'sent');
 assert.equal(calls,2);assert.equal(starts.length,2);assert.equal(ends.length,2);
 assert.equal(ends[1].taskId,'55');
 assert.notEqual(starts[0].id,starts[1].id);assert.deepEqual(starts.map(r=>r.operation),['send','query']);
 assert.doesNotMatch(JSON.stringify({starts,ends,logs}),/secret-token|secret-user|customer private/);
 await sendWorkNotification(n,'',{...options});await sendWorkNotification(n,'secret-user',{...options,env:{...env,DISPATCH_NOTIFICATION_MODE:'mock'}});
 await queryWorkNotification(n,'secret-user',options);await sendWorkNotification(n,'secret-user',{...options,token:async()=>{throw Error('token');}});
 assert.equal(starts.length,2,'validation, mock and token errors do not count as remote calls');
});
test('timeouts/rejections are counted once and recording errors never replay or block a send',async()=>{
 for(const mode of ['network','reject','malformed','record-error','finish-error']) {
  let calls=0,result;
  const options={env,notification:{id:'n',kind:'待检验'},operation:'send',log:()=>{},recorder:{start:async()=>{if(mode==='record-error')throw Error('storage');},finish:async(_,r)=>{result=r;if(mode==='finish-error')throw Error('storage');}},fetcher:async()=>{calls++;if(mode==='network')throw Error('network');return mode==='malformed'?new Response('bad'):new Response(JSON.stringify({errcode:mode==='reject'?88:0}),{status:mode==='reject'?429:200});}};
  if(mode==='network')await assert.rejects(()=>tracedNotificationFetch('https://example.test',{},options));else await tracedNotificationFetch('https://example.test',{},options);
  assert.equal(calls,1);
  if(mode==='network')assert.equal(result.outcome,'transport-unknown');
  if(mode==='reject')assert.equal(result.outcome,'rejected');
  if(mode==='malformed')assert.equal(result.outcome,'response-unknown');
 }
});
test('category aggregation removes vendor and business text from quote titles',()=>{
 assert.equal(notificationTraceKind('procurement',{payload:{title:'供应商甲已提交报价：敏感配件'}}),'供应商已提交报价');
 assert.equal(notificationTraceKind('procurement',{payload:{title:'采购审批通过：敏感配件'}}),'采购审批通过');
});
