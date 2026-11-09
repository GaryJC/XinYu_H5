import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1/unused';
const {queueDueReminders}=await import('../server/workers/dueReminders.mjs');
const now=Date.parse('2026-11-09T10:00:00Z');
const task=(id,shopId='s')=>({orderId:id,shopId,stage:'维修中',orderStatus:'维修中',dueAt:new Date(now+7200000).toISOString(),technicianId:'worker'});
const worker=shopId=>({id:'worker',shopId,role:'technician',active:true});
test('100 eligible orders in one scan use one fresh shop roster; separate shops remain isolated',async()=>{
 const calls=[],queued=[],client={};
 let items=Array.from({length:100},(_,i)=>task(String(i)));
 const options={now,runTransaction:fn=>fn(client),candidates:async()=>items,
  people:async(actor,db)=>{assert.equal(db,client);calls.push(actor.shopId);return [worker(actor.shopId)];},queue:async(db,t,recipients,lead)=>{assert.equal(db,client);assert.equal(lead,1440);assert.ok(recipients.every(r=>r.shopId===t.shopId));queued.push(t.orderId);return recipients.length;}};
 assert.equal(await queueDueReminders(options),100);assert.equal(queued.length,100);assert.deepEqual(calls,['s']);
 calls.length=0;queued.length=0;items=[...items.slice(0,99),task('other','other')];
 assert.equal(await queueDueReminders(options),100);assert.equal(queued.length,100);assert.deepEqual(calls,['s','other']);
});
test('next scan observes revoked membership and an empty/ineligible scan makes no roster request',async()=>{
 let calls=0,allowed=true,items=[task('one'),task('two')];
 const options={now,runTransaction:fn=>fn({}),candidates:async()=>items,people:async()=>{calls++;return allowed?[worker('s')]:[];},queue:async(_db,_task,recipients)=>recipients.length};
 assert.equal(await queueDueReminders(options),2);assert.equal(calls,1);
 allowed=false;assert.equal(await queueDueReminders(options),0);assert.equal(calls,2);
 items=[];await queueDueReminders(options);items=[{...task('done'),stage:'维修完成'}];await queueDueReminders(options);assert.equal(calls,2);
});
test('failed transaction cannot leave a roster for a later scan',async()=>{
 let calls=0,fail=true;
 const options={now,runTransaction:fn=>fn({}),candidates:async()=>[task('one')],people:async()=>{calls++;return [worker('s')];},queue:async()=>{if(fail)throw Error('rollback');return 1;}};
 await assert.rejects(queueDueReminders(options),/rollback/);fail=false;assert.equal(await queueDueReminders(options),1);assert.equal(calls,2);
});
