import test from 'node:test';import assert from 'node:assert/strict';import pg from 'pg';
import {randomUUID} from 'node:crypto';import {readdir,readFile} from 'node:fs/promises';
const adminUrl=process.env.INBOX_TEST_ADMIN_URL;
test('personal inbox commits independently, deduplicates and isolates read state', {skip:!adminUrl,timeout:120000},async()=>{
 const url=new URL(adminUrl);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
 const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
 const name=`inbox_${randomUUID().replaceAll('-','')}`;let db,pool;
 try{
  await admin.query(`create database "${name}"`);url.pathname=`/${name}`;process.env.DATABASE_URL=url.toString();
  db=new pg.Client({connectionString:url.toString()});await db.connect();
  for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f!=='202608070005_remove_obsolete_runfeng_sync_role.sql').sort())await db.query(await readFile(`supabase/migrations/${file}`,'utf8'));
  ({pool}=await import('../server/database/pool.mjs'));
  const {readInbox,markInboxRead,readPersonalWorkbench}=await import('../server/repositories/personalWorkbenchRepository.mjs');
  for(const [id,role] of [['a','advisor'],['b','manager'],['i','inspector'],['w','inspector'],['warehouse','warehouse']])await db.query('insert into users(id,name,role,roles,shop_id) values($1,$1,$2,array[$2],\'shop-hq\')',[id,role]);
  await db.query("insert into work_orders(id,status,advisor,technician,inspector,shop_id,old_parts_handling,vehicle_plate) values('o','维修中','a','w','i','shop-hq','客户带走','鲁B测试')");
  await db.query(`insert into dispatch_tasks(order_id,shop_id,stage,technician_id,data) values('o','shop-hq','待检验','w',$1)`,[JSON.stringify({technicianIds:['w'],items:[{id:1,name:'维修项目',responsibleId:'w',status:'待检验'}]})]);
  const event=async action=>(await db.query("insert into dispatch_events(order_id,actor_id,actor_name,request_id,request_body,action,detail) values('o','a','a',$1,'{}',$2,'{}') returning id",[randomUUID(),action])).rows[0].id;
  const user=id=>({id,name:id,role:id==='a'?'advisor':'manager',roles:[id==='a'?'advisor':'manager'],shopId:'shop-hq',active:true});
  const e=await event('decline');
  await db.query("insert into dispatch_scheduler_notifications(event_id,order_id,kind,payload) values($1,'o','无法接单','{}')",[e]);
  assert.equal((await readInbox(user('a'),{},db)).items.length,1);
  assert.equal((await readInbox(user('b'),{},db)).items.length,0);
  await db.query("insert into dispatch_notifications(id,order_id,event_id,recipient_id,kind,payload,status) values($1,'o',$2,'a','无法接单','{}','failed')",[randomUUID(),e]);
  assert.equal((await readInbox(user('a'),{},db)).items.length,1,'worker fanout does not duplicate');
  const message=(await readInbox(user('a'),{},db)).items[0];
  await markInboxRead(user('b'),{id:message.id},db);assert.equal((await readInbox(user('a'),{},db)).items[0].readAt,null);
  await markInboxRead(user('a'),{through:message.id},db);assert.ok((await readInbox(user('a'),{},db)).items[0].readAt);
  await db.query("insert into dispatch_notifications(id,order_id,recipient_id,kind,payload) values($1,'o','a','人工催办','{}')",[randomUUID()]);
  await markInboxRead(user('a'),{through:message.id},db);assert.equal((await readInbox(user('a'),{unread:true},db)).items.length,1,'new arrivals survive read-all watermark');
  const inspectEvent=await event('submit-order');await db.query("insert into dispatch_inspection_notifications(event_id,order_id) values($1,'o')",[inspectEvent]);
  assert.equal((await readInbox(user('i'),{},db)).items.length,1);assert.equal((await readInbox(user('w'),{},db)).items.length,1,'assigned technician with inspector role receives the transaction inbox event');
  await db.query("update dispatch_tasks set data=jsonb_set(data,'{technicianIds}','null') where order_id='o'");
  const legacyEvent=await event('retry-inspection-notifications');await db.query("insert into dispatch_inspection_notifications(event_id,order_id) values($1,'o')",[legacyEvent]);
  assert.equal((await readInbox(user('w'),{},db)).items.length,2,'scalar technician history does not exclude a qualified inspector');


  // Previous outsourced progress operators remain eligible after an internal round.
  await db.query("insert into users(id,name,role,roles,shop_id) values('former-operator','former-operator','manager',array['manager','inspector'],'shop-hq')");
  await db.query("update dispatch_tasks set data=data||$1::jsonb where order_id='o'",[JSON.stringify({repairRound:1,executionMode:'internal',participantIds:['former-operator','w'],items:[{id:1,name:'追加维修',status:'待检验',responsibleId:'w',startedBy:'w',finishedBy:'w'}]})]);
  for(const [id,patch] of [['disabled',{active:false}],['revoked',{inspector_role_member:false}],['other-shop',{shop_id:'else'}],['stale-primary',{roles:['advisor']}]]) {
   await db.query("insert into users(id,name,role,roles,shop_id,active,inspector_role_member) values($1,$1,'inspector',$2,$3,$4,$5)",[id,patch.roles||['inspector'],patch.shop_id||'shop-hq',patch.active!==false,patch.inspector_role_member!==false]);
  }
  const enqueueInspection=async()=>{const id=await event('retry-inspection-notifications');await db.query("insert into dispatch_inspection_notifications(event_id,order_id) values($1,'o')",[id]);return id;};
  const recipients=async id=>(await db.query("select recipient_id from personal_inbox where event_key=$1 order by recipient_id",[`dispatch:${id}:待检验`])).rows.map(r=>r.recipient_id);
  const roundEvent=await enqueueInspection();
  assert.deepEqual(await recipients(roundEvent),['former-operator','i','w'],'transactional inbox includes previous operators and current repair owners with inspector membership, but excludes invalid users');
  await db.query("insert into dispatch_notifications(id,order_id,event_id,recipient_id,kind,payload) values($1,'o',$2,'former-operator','待检验','{}')",[randomUUID(),roundEvent]);
  assert.deepEqual(await recipients(roundEvent),['former-operator','i','w'],'later delivery fanout does not duplicate the inbox event');
  await db.query("update dispatch_tasks set inspector_id='former-operator' where order_id='o'");
  assert.deepEqual(await recipients(await enqueueInspection()),['former-operator'],'current claim still restricts notification audience');
  await db.query("update dispatch_tasks set inspector_id=null where order_id='o'");
  const originalData=(await db.query("select data from dispatch_tasks where order_id='o'")).rows[0].data;
  for(const patch of [{executionMode:'outsourced'},{needsReview:true},{items:[{id:1,status:'维修中'}]}]) {
   await db.query("update dispatch_tasks set data=$1 where order_id='o'",[{...originalData,...patch}]);
   assert.deepEqual(await recipients(await enqueueInspection()),[],'out-of-state jobs never create inbox actions');
  }
  await db.query("update dispatch_tasks set data=$1 where order_id='o'",[originalData]);
  await db.query("update work_orders set status='待客户签字' where id='o'");
  assert.deepEqual(await recipients(await enqueueInspection()),[],'unsigned orders remain excluded');
  await db.query("update work_orders set status='维修中' where id='o'");

  const count=(await readInbox(user('a'),{},db)).items.length;
  await db.query('begin');await db.query("insert into dispatch_notifications(id,order_id,recipient_id,kind,payload) values($1,'o','a','人工催办','{}')",[randomUUID()]);await db.query('rollback');assert.equal((await readInbox(user('a'),{},db)).items.length,count);
  for(const kind of ['即将到期','检验项目待定','纸质委托书已创建','维修暂停'])await db.query("insert into dispatch_notifications(id,order_id,recipient_id,kind,payload) values($1,'o','a',$2,'{}')",[randomUUID(),kind]);
  assert.equal((await readInbox(user('a'),{},db)).items.length,count);
  const inspectUser={...user('i'),role:'inspector',roles:['inspector']};
  const before=await readPersonalWorkbench(inspectUser,db);assert.equal(before.todos.length,1);
  await markInboxRead(inspectUser,{through:'999999'},db);assert.equal((await readPersonalWorkbench(inspectUser,db)).todos.length,1);
  for(const status of ['待结算','完成']){
   await db.query("update work_orders set status=$1 where id='o'",[status]);
   assert.deepEqual((await readPersonalWorkbench(inspectUser,db)).todos.map(t=>t.category),['待检验']);
  }
  await db.query("update dispatch_tasks set stage='维修完成',data=jsonb_set(data,'{items,0,status}','\"已完工\"') where order_id='o'");
  assert.equal((await readPersonalWorkbench(inspectUser,db)).todos.length,0);
  const {queryDispatchTasks}=await import('../server/services/dispatchService.mjs');
  const part={mode:'list',items:[{name:'滤芯',quantity:1,unit:'个'}]};
  await db.query("update dispatch_tasks set stage='维修中',data=data || $1::jsonb where order_id='o'",[JSON.stringify({
   acceptedAt:'2026-11-16T08:00:00Z',partsRequirement:part,partsRequests:[
    {...part,ownerId:'w',items:[...part.items,{...part.items[0],preparedAt:'2026-11-16T09:00:00Z'}]},
    {...part,ownerId:'a',preparedAt:'2026-11-16T09:00:00Z'}
   ]
  })]);
  for(const roles of [['warehouse'],['manager','warehouse']]){
   const warehouse={...user('warehouse'),role:roles[0],roles};
   const pending=await queryDispatchTasks(warehouse,{partsStatus:'待备料'});
   const partial=await queryDispatchTasks(warehouse,{partsStatus:'部分备齐'});
   const listed=[...pending.items,...partial.items].map(t=>[t.orderId,t.partsRequirement.ownerId||'']);
   const todo=(await readPersonalWorkbench(warehouse,db)).todos.filter(t=>t.category==='配件待备齐');
   assert.deepEqual(listed,[['o',''],['o','w']]);
   assert.equal(todo.length,pending.counts['待备料']+pending.counts['部分备齐']);
   assert.deepEqual(todo.map(t=>[t.targetId,t.partsOwnerId]),listed);
  }
  const tender=randomUUID();await db.query("insert into procurement_tenders(id,shop_id,created_by,request_id,request_body,data) values($1,'shop-hq','warehouse',$2,'{}','{\"partName\":\"测试配件\"}')",[tender,randomUUID()]);
  await db.query("insert into procurement_notification_jobs(id,shop_id,tender_id,payload) values($1,'shop-hq',$2,'{\"title\":\"报价收齐\",\"recipientRole\":\"warehouse\"}')",[randomUUID(),tender]);
  assert.equal((await readInbox(user('warehouse'),{},db)).items.length,1);
  const applicant=user('a');
  await db.query("insert into vehicle_trip_requests(id,shop_id,applicant_id,applicant_name,vehicle_id,vehicle_snapshot,reason) values('trip','shop-hq','a','a','cv_60778','{\"plate\":\"鲁B60778\"}','测试')");
  const enqueue=async action=>{
   const requestId=randomUUID();
   await db.query("insert into vehicle_trip_operations(actor_id,request_id,fingerprint,trip_id,action,actor_name,result) values('a',$1,'test','trip',$2,'a','{}')",[requestId,action]);
   await db.query("insert into vehicle_trip_notification_jobs(id,trip_id,actor_id,request_id,action,payload) values($1,'trip','a',$2,$3,$4)",[randomUUID(),requestId,action,JSON.stringify({shopId:'shop-hq',applicantId:'a',vehicle:{plate:'鲁B60778'},reason:'测试'})]);
  };
  await enqueue('create');assert.equal((await readInbox(user('b'),{},db)).items.filter(m=>m.targetKey==='vehicleTrip').length,1);
  assert.equal((await readInbox(applicant,{},db)).items.filter(m=>m.targetKey==='vehicleTrip').length,0);
  await enqueue('approve');assert.equal((await readInbox(applicant,{},db)).items.filter(m=>m.targetKey==='vehicleTrip').length,1);
  await enqueue('return');assert.equal((await readInbox(user('b'),{},db)).items.filter(m=>m.targetKey==='vehicleTrip').length,1);
  assert.equal((await readInbox({...applicant,shopId:'else'}, {},db)).items.length,0);
  const {readPersonalMessages}=await import('../server/services/personalWorkbenchService.mjs');
  await assert.rejects(readPersonalMessages(applicant,{id:'invalid',through:'1'}),e=>e.status===400);
  assert.deepEqual((await readPersonalWorkbench(applicant,db,{includeTodos:false})).todos,[]);

  const owner={...applicant,name:'已改名'},namesake={...applicant,id:'same-name'};
  await db.query("insert into users(id,name,role,roles,shop_id) values($1,$2,'advisor',array['advisor'],$3)",[namesake.id,namesake.name,namesake.shopId]);
  await db.query('update users set name=$2 where id=$1',[owner.id,owner.name]);
  await db.query("update work_orders set advisor_user_id=$1,status='待客户签字' where id='o'",[owner.id]);
  const todoCategories=async u=>(await readPersonalWorkbench(u,db)).todos.filter(t=>t.targetId==='o').map(t=>t.category);
  assert.deepEqual(await todoCategories(owner),['待客户签字']);
  assert.deepEqual(await todoCategories(namesake),[]);
  const refusal=await event('decline');
  await db.query("insert into dispatch_scheduler_notifications(event_id,order_id,kind,payload) values($1,'o','无法接单','{}')",[refusal]);
  const inboxRecipients=async()=>(await db.query('select recipient_id from personal_inbox where event_key=$1',[`dispatch:${refusal}:无法接单`])).rows.map(r=>r.recipient_id);
  assert.deepEqual(await inboxRecipients(),[owner.id]);
  const {processSchedulerNotifications,validateSchedulerRecipient}=await import('../server/workers/schedulerNotifications.mjs');
  while(await processSchedulerNotifications({env:{DISPATCH_NOTIFICATION_MODE:'disabled'}})){}
  const {rows:notices}=await db.query("select * from dispatch_notifications where event_id=$1 and kind='无法接单'",[refusal]);
  assert.deepEqual(notices.map(n=>n.recipient_id),[owner.id]);
  assert.equal(await validateSchedulerRecipient(notices[0],owner,{database:db}),true);
  assert.equal(await validateSchedulerRecipient({...notices[0],recipient_id:namesake.id},namesake,{database:db}),false);
  assert.deepEqual(await inboxRecipients(),[owner.id]);

 }finally{await pool?.end();await db?.end();await admin.query(`drop database if exists "${name}" with (force)`);await admin.end();}
});
