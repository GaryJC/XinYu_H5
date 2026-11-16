import test from 'node:test';import assert from 'node:assert/strict';
import {addBusinessMinutes,isBusinessTime,pendingSnapshotSlots,reminderRecipient} from '../server/domain/pendingReminders.mjs';
const local=s=>new Date(s+'+08:00');
test('business clock pauses nights, rolls exact closing boundary and includes every calendar day',()=>{
 assert.equal(addBusinessMinutes(local('2026-11-15T17:30:00'),60).toISOString(),local('2026-11-16T08:30:00').toISOString());
 assert.equal(addBusinessMinutes(local('2026-11-15T19:00:00'),30).toISOString(),local('2026-11-16T08:30:00').toISOString());
 assert.equal(addBusinessMinutes(local('2026-11-15T17:30:00'),30).toISOString(),local('2026-11-16T08:00:00').toISOString());
 assert.equal(isBusinessTime(local('2026-11-15T18:00:00')),false);assert.equal(isBusinessTime(local('2026-11-15T08:00:00')),true);
});
test('independent inspection items create distinct slots; claiming does not reset them',()=>{
 const snapshot={order:{status:'维修中',shop_id:'s'},task:{stage:'维修中',shopId:'s',orderId:'o',items:[{id:1,status:'待检验',finishAt:'a'},{id:2,status:'维修中'}]}};
 const first=pendingSnapshotSlots(snapshot);assert.equal(first.length,1);
 assert.deepEqual(pendingSnapshotSlots({...snapshot,task:{...snapshot.task,inspectorId:'i'}}),first);
 assert.notEqual(pendingSnapshotSlots({...snapshot,task:{...snapshot.task,repairRound:2}})[0].key,first[0].key);
});
test('paper reminders first target advisor and only escalate to manager; trips exclude applicant',()=>{
 const snapshot={order:{shop_id:'s'},task:{advisor:'顾问'}};
 const advisor={id:'a',name:'顾问',role:'advisor',shopId:'s',active:true},manager={id:'m',role:'manager',shopId:'s',active:true};
 const slot={kind:'委托书待同步'};
 assert.equal(reminderRecipient(slot,snapshot,advisor,0),true);assert.equal(reminderRecipient(slot,snapshot,manager,0),false);
 assert.equal(reminderRecipient(slot,snapshot,manager,1),true);assert.equal(reminderRecipient(slot,snapshot,{...manager,shopId:'other'},1),false);
 assert.equal(reminderRecipient({kind:'用车待审批'},{trip:{shop_id:'s',applicant_id:'m'}},manager,1),false);
});

test('digest merges inspection items and escalation for the same card; no automatic resend after ambiguous submission',async()=>{
 process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:1/unused';
 const {deliverPendingDigest}=await import('../server/workers/pendingReminders.mjs');
 const {pendingMessageBody}=await import('../server/integrations/dingtalk/pendingReminders.mjs');
 const rows=[{id:1,level:0},{id:2,level:1}],finished=[];let calls=0;
 const base={env:{APP_ENV:'test',DISPATCH_NOTIFICATION_MODE:'mock'},claim:async()=>rows,seal:async()=>true,context:async()=>({user:{id:'i',name:'i',dingtalk_user_id:'ding'},subject:{source_key:'order',target_id:'o',shop_id:'s',entered_at:'2026-11-15T00:00:00Z'},slot:{kind:'待检验',title:'鲁B测试'}}),finish:async(row,result)=>finished.push(result.status)};
 await deliverPendingDigest({...base,send:async(notification)=>{calls++;assert.equal(notification.payload.items.length,1);assert.equal(notification.payload.items[0].level,1);const body=pendingMessageBody(notification,'ding',{DISPATCH_APP_URL:'https://example.com',DINGTALK_AGENT_ID:'1'});assert.match(body.msg.markdown.text,/personalTasks=true/);return {status:'accepted'};}});
 assert.equal(calls,1);assert.deepEqual(finished,['accepted','accepted']);finished.length=0;
 await deliverPendingDigest({...base,send:async()=>{throw Error('unknown');}});assert.deepEqual(finished,['unknown','unknown']);
});
