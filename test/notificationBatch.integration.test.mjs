import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
const adminUrl=process.env.NOTIFICATION_BATCH_TEST_ADMIN_URL;
test('durable notification batches preserve claims, snapshots, retries, partial results and usage', {skip:!adminUrl},async t=>{
 const url=new URL(adminUrl);assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
 const admin=new pg.Client({connectionString:adminUrl});await admin.connect();const name='batch_'+randomUUID().replaceAll('-','');let pool;
 try{
  await admin.query(`create database "${name}"`);url.pathname='/'+name;process.env.DATABASE_URL=url.toString();process.env.APP_ENV='test';
  ({pool}=await import('../server/database/pool.mjs'));
  for(const f of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f!=='202608070005_remove_obsolete_runfeng_sync_role.sql').sort())await pool.query(await fs.readFile('supabase/migrations/'+f,'utf8'));
  const repo=await import('../server/repositories/notificationBatchRepository.mjs');
  const {notificationRecipient,finishNotification}=await import('../server/repositories/dispatchNotificationRepository.mjs');
  const {deliverNotificationGroup}=await import('../server/workers/notificationBatches.mjs');
  const {processNotification}=await import('../server/workers/dispatchNotifications.mjs');
  const service=await import('../server/services/notificationQueryService.mjs');
  const tracing=await import('../server/repositories/notificationUsageRepository.mjs');
  const actor={id:'manager',shopId:'s'};
  for(const id of ['manager','u1','u2','u3'])await pool.query("insert into users(id,name,role,roles,shop_id,dingtalk_user_id) values($1,$1,'manager',array['manager'],'s',$2)",[id,'ding-'+id]);
  for(const id of ['order','other']){
   await pool.query("insert into work_orders(id,status,advisor,technician,inspector,shop_id,old_parts_handling) values($1,'维修中','顾问','维修工','检验员',$2,'客户带走')",[id,id==='order'?'s':'other']);
   await pool.query("insert into dispatch_tasks(order_id,shop_id,stage) values($1,$2,'维修中')",[id,id==='order'?'s':'other']);
  }
  const create=async({event=true,round=1,order='order',kind='新派工',users=['u1','u2','u3']}={})=>{
   const eid=event?(await pool.query("insert into dispatch_events(order_id,actor_id,actor_name,request_id,request_body,action,detail) values($1,'manager','manager',$2,'{}','assign','{}') returning id",[order,randomUUID()])).rows[0].id:null;
   const ids=[];for(const user of users){const id=randomUUID();ids.push(id);await pool.query('insert into dispatch_notifications(id,order_id,event_id,recipient_id,kind,payload) values($1,$2,$3,$4,$5,$6)',[id,order,eid,user,kind,JSON.stringify({orderId:order,repairRound:round,summary:'same'})]);}return ids;
  };
  const get=async ids=>(await pool.query('select * from dispatch_notifications where id=any($1::uuid[]) order by recipient_id',[ids])).rows;
  const seal=async rows=>{const members=await Promise.all(rows.map(async row=>({row,recipient:(await notificationRecipient(row.recipient_id)).dingtalk_user_id})));const id=await repo.sealNotificationBatch('dispatch',members,'hash');return {id,members};};
  let batch,ids;
  await t.test('preparation crashes recover after lease expiry but stale preparers cannot seal',async()=>{
   const noticeIds=await create({users:['u1']});const first=await repo.claimNotificationGroup('dispatch');
   assert.equal(first[0].status,'pending');
   await pool.query("update dispatch_notifications set locked_until=now()-interval '1 second' where id=$1",[noticeIds[0]]);
   const recovered=await repo.claimNotificationGroup('dispatch');assert.equal(recovered.length,1);assert.notEqual(recovered[0].lease_id,first[0].lease_id);
   await assert.rejects(()=>seal(first));const current=await seal(recovered);
   await repo.finishNotificationBatch('dispatch',current.id,current.members,{status:'accepted',taskId:'recovered'});
  });
  await t.test('same event recipients are claimed once across workers; crash never reclaims unknown',async()=>{
   ids=await create();const claims=await Promise.all([repo.claimNotificationGroup('dispatch'),repo.claimNotificationGroup('dispatch')]);
   const all=claims.flat();assert.equal(all.length,3);assert.equal(new Set(all.map(r=>r.id)).size,3);
   batch=await seal(all);assert.equal((await get(ids)).every(r=>r.delivery_batch_id===batch.id&&r.status==='unknown'&&r.delivery_user_id),true);
   await pool.query("update dispatch_notifications set locked_until=now()-interval '1 second' where id=any($1::uuid[])",[ids]);
   assert.equal((await repo.claimNotificationGroup('dispatch')).length,0);
   await repo.finishNotificationBatch('dispatch',batch.id,batch.members,{status:'accepted',taskId:'task-one'});
   assert.ok((await get(ids)).every(r=>r.task_id==='task-one'&&r.status==='accepted'&&r.next_attempt_at===null));
  });
  await t.test('one manual query updates all members using original accounts; concurrent sibling click blocked',async()=>{
   await pool.query("update dispatch_notifications set delivery_submitted_at=now()-interval '1 minute' where id=any($1::uuid[])",[ids]);
   await pool.query("update users set dingtalk_user_id='changed-account' where id='u1'");
   let calls=0,release,enter;const entered=new Promise(r=>enter=r),wait=new Promise(r=>release=r);
   const query=async(_n,targets)=>{calls++;assert.deepEqual(targets.sort(),['ding-u1','ding-u2','ding-u3']);enter();await wait;return {recipients:[{recipient:'ding-u1',status:'sent'},{recipient:'ding-u2',status:'failed',error:'invalid'},{recipient:'ding-u3',status:'accepted'}]};};
   const first=service.queryNotificationDelivery(actor,'dispatch',ids[0],{query});await entered;
   await assert.rejects(()=>service.queryNotificationDelivery(actor,'dispatch',ids[1],{query}),e=>e.status===409);
   release();assert.equal((await first).status,'sent');assert.equal(calls,1);
   assert.deepEqual((await get(ids)).map(r=>r.status),['sent','failed','accepted']);
   await assert.rejects(()=>service.queryNotificationDelivery(actor,'dispatch',ids[2],{query}),e=>e.status===409);
   // Retrying only the failed member leaves successful/uncertain siblings alone.
   await pool.query("update dispatch_notifications set status='pending',next_attempt_at=now() where id=$1",[ids[1]]);
   const retry=await repo.claimNotificationGroup('dispatch');assert.deepEqual(retry.map(r=>r.id),[ids[1]]);
   assert.equal(retry[0].status,'pending');assert.equal(retry[0].task_id,null);assert.equal(retry[0].delivery_batch_id,null);assert.equal(retry[0].delivery_user_id,null);
   await pool.query("update notification_delivery_batches set result_queried_at=now()-interval '1 minute' where id=$1",[batch.id]);
   const oldQuery=await repo.claimBatchQuery('dispatch',(await get([ids[2]]))[0]);
   assert.ok(!(await repo.batchQueryMembers('dispatch',oldQuery)).some(r=>r.id===ids[1]));
   await repo.saveBatchQuery('dispatch',oldQuery,[{id:ids[1],status:'sent',error:''}]);
   assert.equal((await get([ids[1]]))[0].status,'pending');
   const next=await seal(retry);await repo.finishNotificationBatch('dispatch',next.id,next.members,{status:'accepted',taskId:'task-two'});
   assert.equal((await get(ids))[0].task_id,'task-one');assert.equal((await get(ids))[1].task_id,'task-two');
  });
  await t.test('usage counts one request but associates every recipient and never exposes credentials',async()=>{
   const trace=randomUUID();await tracing.startNotificationTrace(pool,{id:trace,source:'dispatch',notificationId:ids[0],kind:'新派工',operation:'send',batchId:batch.id});
   const day=new Date(Date.now()+8*3600000).toISOString().slice(0,10);const usage=await tracing.readNotificationUsage(pool,'s',day,1);
   assert.equal(usage.daily.at(-1).total,1);assert.equal(usage.rows[0].recipientCount,3);assert.equal(usage.rows[0].batchId,batch.id);assert.equal(usage.recipients.length,3);assert.ok(usage.recipients.every(r=>r.total===1));
   assert.doesNotMatch(JSON.stringify(usage),/ding-u|changed-account/);
  });
  await t.test('different events, rounds, resources and legacy records never enter one claim',async()=>{
   const a=await create({users:['u1','u2']});const b=await create({users:['u1']});const c=await create({event:false,users:['u1','u2']});const d=await create({order:'other',users:['u1']});
   await pool.query("update dispatch_notifications set payload=jsonb_set(payload,'{repairRound}','2') where id=$1",[a[1]]);
   const groups=[];while(true){const next=await repo.claimNotificationGroup('dispatch');if(!next.length)break;groups.push(next);}
   assert.equal(groups.length,6);assert.equal(groups.flat().length,a.length+b.length+c.length+d.length);
  });
  await t.test('stale lease and changed binding block sealing; expired previous result cannot overwrite retry',async()=>{
   const notices=await create({users:['u1']});const rows=await repo.claimNotificationGroup('dispatch');const members=[{row:rows[0],recipient:'changed-account'}];
   await pool.query("update users set dingtalk_user_id='new-account' where id='u1'");await assert.rejects(()=>repo.sealNotificationBatch('dispatch',members,'hash'));
   members[0].recipient='new-account';await pool.query("update users set shop_id='other' where id='u1'");await assert.rejects(()=>repo.sealNotificationBatch('dispatch',members,'hash'));await pool.query("update users set shop_id='s' where id='u1'");await pool.query('update dispatch_notifications set lease_id=$2 where id=$1',[notices[0],randomUUID()]);await assert.rejects(()=>repo.sealNotificationBatch('dispatch',members,'hash'));
   const row=(await get([ids[2]]))[0];await pool.query("update notification_delivery_batches set result_queried_at=now()-interval '1 minute' where id=$1",[batch.id]);
   const claim=await repo.claimBatchQuery('dispatch',row);assert.ok(claim);
   await pool.query('update notification_delivery_batches set lease_id=$2 where id=$1',[batch.id,randomUUID()]);
   assert.equal(await repo.saveBatchQuery('dispatch',claim,[{id:row.id,status:'sent',error:''}]),false);assert.equal((await get([row.id]))[0].status,'accepted');
  });
  await t.test('procurement and vehicle requests use the same durable grouping with current audiences',async()=>{
   await pool.query("update users set active=true where id='u2'");
   const tender=randomUUID(),job=randomUUID();
   await pool.query("insert into procurement_tenders(id,shop_id,created_by,request_id,request_body,data) values($1,'s','manager',$2,'{}','{}')",[tender,randomUUID()]);
   const payload={title:'采购提报审批：测试',recipientRole:'manager',notificationBatchId:job,tenderId:tender,summary:'same'};
   for(const user of ['u1','u2'])await pool.query("insert into procurement_notifications(id,shop_id,tender_id,recipient_id,payload) values($1,'s',$2,$3,$4)",[randomUUID(),tender,user,JSON.stringify(payload)]);
   const {deliverProcurementNotification}=await import('../server/workers/procurementWorker.mjs');
   const {finishDelivery}=await import('../server/repositories/procurementNotificationRepository.mjs');
   const {procurementMessageBody}=await import('../server/integrations/dingtalk/procurementNotifications.mjs');
   let calls=0;await deliverNotificationGroup('procurement',{env:{APP_ENV:'test',DISPATCH_NOTIFICATION_MODE:'mock'},prepare:row=>deliverProcurementNotification({claim:async()=>row,prepareOnly:true}),finish:finishDelivery,buildMessage:procurementMessageBody,send:async(_n,ids)=>{calls++;assert.equal(ids.split(',').length,2);return {status:'accepted',taskId:'procurement'};}});assert.equal(calls,1);
   await pool.query("insert into company_vehicles(id,shop_id,plate,brand,model) values('car','s','TEST','test','test')");
   await pool.query("insert into vehicle_trip_requests(id,shop_id,applicant_id,applicant_name,vehicle_id,vehicle_snapshot,reason,status) values('trip','s','manager','manager','car','{}','test','待审批')");
   await pool.query("insert into vehicle_trip_operations(actor_id,request_id,fingerprint,trip_id,action,actor_name,result) values('manager','create-trip','test','trip','create','manager','{}')");
   const tripPayload={id:'trip',shopId:'s',status:'待审批',applicantName:'manager',vehicle:{plate:'TEST'},reason:'test'};
   await pool.query("insert into vehicle_trip_notification_jobs(id,trip_id,actor_id,request_id,action,payload) values('trip-job','trip','manager','create-trip','create',$1)",[JSON.stringify(tripPayload)]);
   for(const user of ['u1','u2'])await pool.query("insert into vehicle_trip_notifications(id,job_id,recipient_id) values($1,'trip-job',$2)",[randomUUID(),user]);
   const {processTripNotification}=await import('../server/workers/vehicleTripNotifications.mjs');
   const {finishTripDelivery}=await import('../server/repositories/vehicleTripNotificationRepository.mjs');
   const {vehicleTripMessageBody}=await import('../server/integrations/dingtalk/vehicleTripNotifications.mjs');
   calls=0;await deliverNotificationGroup('vehicle-trip',{env:{APP_ENV:'test',DISPATCH_NOTIFICATION_MODE:'mock'},prepare:row=>processTripNotification({claim:async()=>row,prepareOnly:true}),finish:(row,result)=>finishTripDelivery(row,result,pool),buildMessage:vehicleTripMessageBody,send:async(_n,ids)=>{calls++;assert.equal(ids.split(',').length,2);return {status:'accepted',taskId:'trip-task'};}});assert.equal(calls,1);
  });
  await t.test('real transport path records exactly one send for three recipients and no automatic query',async()=>{
   await pool.query("update users set active=true where id='u2'");const noticeIds=await create();
   const {sendWorkNotification}=await import('../server/integrations/dingtalk/notifications.mjs');
   let calls=0;const env={APP_ENV:'test',DISPATCH_NOTIFICATION_MODE:'dingtalk',DINGTALK_AGENT_ID:'1',DINGTALK_APP_KEY:'fixture',DINGTALK_APP_SECRET:'fixture',DISPATCH_APP_URL:'https://example.test'};
   await deliverNotificationGroup('dispatch',{env,prepare:row=>processNotification({claim:async()=>row,prepareOnly:true}),finish:finishNotification,send:(n,ids,options)=>sendWorkNotification(n,ids,{...options,token:async()=>'fixture',log:()=>{},recorder:{start:c=>tracing.startNotificationTrace(pool,c),finish:(id,r)=>tracing.finishNotificationTrace(pool,id,r)},fetcher:async(url,request)=>{
    calls++;assert.match(url.pathname,/asyncsend_v2$/);assert.equal(JSON.parse(request.body).userid_list.split(',').length,3);return new Response(JSON.stringify({errcode:0,task_id:12345}));
   }})});
   assert.equal(calls,1);const delivered=await get(noticeIds);assert.ok(delivered.every(n=>n.status==='accepted'&&n.task_id==='12345'&&n.next_attempt_at===null));
   const traces=(await pool.query('select * from notification_call_traces where delivery_batch_id=$1',[delivered[0].delivery_batch_id])).rows;assert.equal(traces.length,1);assert.equal(traces[0].recipient_count,3);
   await pool.query("update dispatch_notifications set delivery_submitted_at=now()-interval '1 minute' where id=any($1::uuid[])",[noticeIds]);
   await assert.rejects(()=>service.queryNotificationDelivery(actor,'dispatch',noticeIds[0],{query:async()=>{await pool.query("update users set role='employee',roles=array['employee'] where id='manager'");return {status:'sent'};}}),e=>e.status===403);
   await pool.query("update users set role='manager',roles=array['manager'] where id='manager'");
   assert.ok((await get(noticeIds)).every(n=>n.status==='sent'));
   assert.equal((await pool.query('select lease_id from notification_delivery_batches where id=$1',[delivered[0].delivery_batch_id])).rows[0].lease_id,null);
  });
  await t.test('production dispatch preparation preserves revoked and retired notifications',async()=>{
   await create({kind:'维修暂停'});let sends=0;
   await deliverNotificationGroup('dispatch',{env:{APP_ENV:'test',DISPATCH_NOTIFICATION_MODE:'mock'},prepare:row=>processNotification({claim:async()=>row,prepareOnly:true}),finish:finishNotification,send:async()=>{sends++;return {status:'accepted'};}});
   assert.equal(sends,0);
   await create();await pool.query("update users set active=false where id='u2'");
   const start=performance.now();let recipients;
   await deliverNotificationGroup('dispatch',{env:{APP_ENV:'test',DISPATCH_NOTIFICATION_MODE:'mock'},prepare:row=>processNotification({claim:async()=>row,prepareOnly:true}),finish:finishNotification,send:async(_n,r)=>{sends++;recipients=r;return {status:'accepted',taskId:'final'};}});
   assert.equal(sends,1);assert.equal(recipients.split(',').length,2);assert.ok(!recipients.includes('ding-u2'));
   console.log('three-member batch local preparation/persistence ms',performance.now()-start);
  });
 }finally{if(pool)await pool.end();await admin.query(`drop database if exists "${name}" with(force)`);await admin.end();}
});
