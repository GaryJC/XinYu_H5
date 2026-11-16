import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:1/unused';
const {queueInsuranceReminders,deliverInsuranceReminder}=await import('../server/workers/vehicleInsuranceNotifications.mjs');
const {insuranceToday}=await import('../shared/vehicleInsurance.mjs');
const env={APP_ENV:'test',DISPATCH_NOTIFICATION_MODE:'mock'};
const end=insuranceToday(new Date(Date.now()+7*86400000));
test('disabled notification mode does no work',async()=>{
 const database={query:()=>assert.fail('unexpected I/O')};
 await queueInsuranceReminders({database,env:{DISPATCH_NOTIFICATION_MODE:'disabled'}});
 assert.equal(await deliverInsuranceReminder({database,env:{DISPATCH_NOTIFICATION_MODE:'disabled'}}),false);
});
test('delivery rechecks dates, active roles and shop; uncertain sends never retry',async()=>{
 for(const change of [{},{role:'employee',roles:[]},{active:false},{vehicle_active:false},{shop_id:'other'},{end_date:'2099-01-01'},{role:'employee',roles:['advisor']}]){
  let sent=0,finished;
  const row={id:'n',lease_id:'lease',previous_status:'pending',recipient_id:'u',vehicle_id:'v',end_date:end,milestone:7,attempts:1};
  const context={active:true,vehicle_active:true,shop_id:'shop',vehicle_shop:'shop',role:'manager',dingtalk_user_id:'ding',end_date:end,...change};
  const database={query:async(sql,args)=>{
   if(sql.startsWith('with candidate'))return {rows:[row]};
   if(sql.startsWith('select v.plate'))return {rows:[context]};
   finished=args;return {rows:[]};
  }};
  await deliverInsuranceReminder({database,env,send:async()=>{sent++;return {status:'accepted',taskId:'task'};}});
  const valid=Object.keys(change).length===0||change.roles?.includes('advisor');
  assert.equal(sent,valid?1:0);assert.equal(finished[2],valid?'accepted':'failed');
 }
 const database={query:async(sql,args)=>{
  if(sql.startsWith('with candidate'))return {rows:[{id:'n',lease_id:'l',previous_status:'pending',end_date:end,milestone:7,attempts:1}]};
  if(sql.startsWith('select v.plate'))return {rows:[{active:true,vehicle_active:true,shop_id:'s',vehicle_shop:'s',role:'advisor',dingtalk_user_id:'d',end_date:end}]};
  assert.equal(args[2],'unknown');assert.equal(args[6],null);return {rows:[]};
 }};
 await deliverInsuranceReminder({database,env,send:async()=>{throw Error('network');}});
});
test('roster sync is once per shop and includes advisors and managers',async()=>{
 let syncs=0,inserts=0;
 const database={query:async(sql,args)=>{if(sql.startsWith('select *,insurance_end'))return {rows:[{id:'a',shop_id:'s',end_date:end,milestone:7},{id:'b',shop_id:'s',end_date:end,milestone:7}]};inserts++;assert.deepEqual(args[5],['advisor','manager']);return {rows:[]};}};
 await queueInsuranceReminders({database,env:{DISPATCH_NOTIFICATION_MODE:'dingtalk',DINGTALK_AGENT_ID:'1',DINGTALK_APP_KEY:'test',DINGTALK_APP_SECRET:'test',DISPATCH_APP_URL:'https://example.com'},sync:async(shop,options)=>{syncs++;assert.deepEqual(options.roleKeys,['manager','advisor']);return ['advisor','manager'];}});
 assert.equal(syncs,1);assert.equal(inserts,2);
});
