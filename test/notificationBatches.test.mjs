import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL||='postgresql://localhost/unused';
const {deliverNotificationGroup}=await import('../server/workers/notificationBatches.mjs');
import {queryWorkNotification} from '../server/integrations/dingtalk/notifications.mjs';
const env={APP_ENV:'test',DISPATCH_NOTIFICATION_MODE:'mock'};
const rows=[1,2,3].map(id=>({id:String(id),attempts:1,lease_id:'lease',payload:{}}));
const setup=(changes={})=>{
 const sent=[],finished=[],sealed=[],completed=[];
 return {sent,finished,sealed,completed,options:{env,claim:async()=>rows,prepare:async row=>({notification:row,recipient:'u'+row.id}),finish:async(row,result)=>finished.push({row,result}),buildMessage:n=>({msg:{text:n.text||'same'},userid_list:''}),seal:async(m,hash)=>{sealed.push({m,hash});return 'batch'+sealed.length;},complete:async(id,m,result)=>completed.push({id,m,result}),send:async(n,ids,options)=>{sent.push({n,ids,body:options.buildMessage(n,ids)});return {status:'accepted',taskId:'task'};},...changes}};
};
test('identical final messages use one call with individual records; personalized content splits',async()=>{
 let c=setup();assert.equal(await deliverNotificationGroup('dispatch',c.options),true);assert.equal(c.sent.length,1);assert.equal(c.sent[0].ids,'u1,u2,u3');assert.equal(c.completed[0].m.length,3);
 c=setup({prepare:async row=>({notification:{...row,text:row.id==='3'?'different':'same'},recipient:'u'+row.id})});await deliverNotificationGroup('dispatch',c.options);assert.equal(c.sent.length,2);
});
test('suppressed, revoked, changed content and invalid bindings never join a send',async()=>{
 const counts=new Map();const c=setup({prepare:async row=>{
  const n=(counts.get(row.id)||0)+1;counts.set(row.id,n);
  if(row.id==='1')return {result:{status:'suppressed'}};
  if(row.id==='2'&&n>1)return {result:{status:'failed',retryable:false}};
  return {notification:row,recipient:''};
 }});await deliverNotificationGroup('dispatch',c.options);assert.equal(c.sent.length,0);assert.equal(c.finished.length,3);
 const d=setup({prepare:async row=>({notification:row,recipient:'shared'})});await deliverNotificationGroup('dispatch',d.options);assert.equal(d.sent[0].ids,'shared');assert.equal(d.completed[0].m.length,3);
});
test('seal failure sends nothing; response loss and commit failure never replay',async()=>{
 let c=setup({seal:async()=>{throw Error('db');}});await deliverNotificationGroup('dispatch',c.options);assert.equal(c.sent.length,0);
 c=setup({send:async()=>{throw Error('timeout');}});await deliverNotificationGroup('dispatch',c.options);assert.equal(c.completed[0].result.status,'unknown');
 c=setup({complete:async()=>{throw Error('commit');}});await assert.rejects(()=>deliverNotificationGroup('dispatch',c.options));assert.equal(c.sent.length,1);
});
test('one task query resolves each actual account including partial failure and unknown',async()=>{
 let calls=0;const result=await queryWorkNotification({task_id:'55'},['u1','u2','u3'],{env:{APP_ENV:'test'},token:async()=>'token',fetcher:async()=>{calls++;return new Response(JSON.stringify({errcode:0,send_result:{unread_user_id_list:['u1'],forbidden_list:[{userid:'u2'}]}}));}});
 assert.equal(calls,1);assert.deepEqual(result.recipients.map(r=>r.status),['sent','failed','accepted']);
});
