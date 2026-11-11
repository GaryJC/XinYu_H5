import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
const adminUrl=process.env.NOTIFICATION_USAGE_TEST_ADMIN_URL;
test('notification usage records real attempts, isolates shops and calculates complete-day averages', {skip:!adminUrl},async()=>{
 const url=new URL(adminUrl);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
 const admin=new pg.Client({connectionString:adminUrl});await admin.connect();const name='usage_'+randomUUID().replaceAll('-','');let db;
 try{
  await admin.query(`create database "${name}"`);url.pathname='/'+name;process.env.DATABASE_URL=url.toString();process.env.APP_ENV='test';
  db=new pg.Client({connectionString:url.toString()});await db.connect();
  for(const f of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f!=='202608070005_remove_obsolete_runfeng_sync_role.sql').sort())await db.query(await fs.readFile('supabase/migrations/'+f,'utf8'));
  const {startNotificationTrace:start,finishNotificationTrace:finish}=await import('../server/repositories/notificationUsageRepository.mjs');
  const {notificationUsage:usage}=await import('../server/services/notificationUsageService.mjs');
  for(const [id,role,shop] of [['manager','manager','s'],['worker','technician','s'],['outsider','manager','other']])await db.query('insert into users(id,name,role,shop_id) values($1,$1,$2,$3)',[id,role,shop]);
  await db.query("insert into work_orders(id,status,advisor,technician,inspector,shop_id,old_parts_handling) values('order','维修中','顾问','维修工','检验','s','客户带走')");
  const notice=randomUUID();await db.query("insert into dispatch_notifications(id,order_id,recipient_id,kind,payload) values($1,'order','worker','新派工','{}')",[notice]);
  assert.equal((await db.query('select count(*)::int total from notification_tracking_epoch')).rows[0].total,0);
  const id=randomUUID();await start(db,{id,source:'dispatch',notificationId:notice,operation:'send',kind:'新派工'});
  await finish(db,id,{outcome:'ok',httpStatus:200,apiCode:'0',durationMs:25,taskId:'123'});
  // Verify context extraction for every other source, without reading cloud APIs.
  const tender=randomUUID(),exception=randomUUID();
  await db.query("insert into procurement_tenders(id,shop_id,created_by,request_id,request_body,data) values($1,'s','manager',$2,'{}','{}')",[tender,randomUUID()]);
  await db.query("insert into company_vehicles(id,shop_id,plate,brand,model) values('car','s','TEST','test','test')");
  await db.query("insert into vehicle_trip_requests(id,shop_id,applicant_id,applicant_name,vehicle_id,vehicle_snapshot,reason) values('trip','s','manager','test','car','{}','test')");
  await db.query("insert into vehicle_trip_operations(actor_id,request_id,fingerprint,trip_id,action,actor_name,result) values('manager','trip-op','test','trip','return','test','{}')");
  await db.query("insert into vehicle_trip_notification_jobs(id,trip_id,actor_id,request_id,action,payload) values('job','trip','manager','trip-op','return','{}')");
  await db.query("insert into vehicle_license_exceptions(id,order_id,request_id,vehicle_plate,vehicle_vin,reason,reported_by,reported_name,payload) values($1,'order','license','TEST','','test','manager','test','{}')",[exception]);
  for(const [source,sql,params] of [
   ['procurement',"insert into procurement_notifications(id,shop_id,tender_id,recipient_id,payload) values($1,'s',$2,'worker','{}')",[tender]],
   ['vehicle-trip',"insert into vehicle_trip_notifications(id,job_id,recipient_id) values($1,'job','worker')",[]],
   ['license-exception',"insert into vehicle_license_exception_notifications(id,exception_id,recipient_id) values($1,$2,'worker')",[exception]],
   ['vehicle-insurance',"insert into vehicle_insurance_notifications(id,vehicle_id,recipient_id,insurance_end,milestone) values($1,'car','worker',current_date,1)",[]]
  ]){const nid=randomUUID(),tid=randomUUID();await db.query(sql,[nid,...params]);await start(db,{id:tid,source,notificationId:nid,kind:'test',operation:'query'});const record=(await db.query('select * from notification_call_traces where id=$1',[tid])).rows[0];assert.equal(record.shop_id,'s');assert.equal(record.recipient_name,'worker');assert.ok(record.event_key);await db.query('delete from notification_call_traces where id=$1',[tid]);}
  const timings=[];
  for(let i=0;i<40;i++){const tid=randomUUID(),t=performance.now();await start(db,{id:tid,source:'dispatch',notificationId:notice,kind:'新派工',operation:'send'});await finish(db,tid,{outcome:'ok',durationMs:1});timings.push(performance.now()-t);await db.query('delete from notification_call_traces where id=$1',[tid]);}
  timings.sort((a,b)=>a-b);console.log('trace persistence ms',JSON.stringify({p50:timings[19],p95:timings[37]}));
  await db.query("update notification_tracking_epoch set started_at='2026-11-01T04:00:00Z'");
  await db.query("update notification_call_traces set started_at='2026-11-10T16:01:00Z'");
  // Retry is a separate actual call, attached to the same notice.
  const retry=randomUUID();await start(db,{id:retry,source:'dispatch',notificationId:notice,operation:'send',kind:'新派工'});
  await db.query("update notification_call_traces set started_at='2026-11-10T15:59:00Z' where id=$1",[retry]);
  const opts={database:db,now:Date.parse('2026-11-11T05:00:00Z')},query=new URLSearchParams('date=2026-11-11');
  const manager={id:'manager',shopId:'s'};let data=await usage(manager,query,opts);
  assert.equal(data.daily.find(d=>d.date==='2026-11-11').total,1);assert.equal(data.daily.find(d=>d.date==='2026-11-10').total,1);
  assert.equal(data.completeDays,6);assert.equal(data.average,0.2);assert.equal(data.budget,300);
  assert.equal(data.rows[0].id,id);assert.equal(data.rows[0].platformTaskId,'123');assert.equal(data.recipients[0].name,'worker');
  assert.equal((await usage({id:'outsider',shopId:'other'},query,opts)).rows.length,0);
  await assert.rejects(()=>usage({id:'worker',shopId:'s'},query,opts),e=>e.status===403);
  await assert.rejects(()=>usage({id:'manager',shopId:'other'},query,opts),e=>e.status===403);
  for(const q of ['date=2026-02-30','date=2027-01-01','page=-1','page=1.5'])await assert.rejects(()=>usage(manager,new URLSearchParams(q),opts),e=>e.status===400);
  await db.query("update notification_tracking_epoch set started_at='2026-11-10T04:00:00Z'");data=await usage(manager,query,opts);assert.equal(data.average,null);assert.equal(data.completeDays,0);
  await db.query("update users set role='advisor' where id='manager'");await assert.rejects(()=>usage(manager,query,opts),e=>e.status===403);
  await db.query("update users set role='manager' where id='manager'");
  await db.query("update users set active=false where id='manager'");await assert.rejects(()=>usage(manager,query,opts),e=>e.status===403);
 } finally {if(db)await db.end();await admin.query(`drop database if exists "${name}" with(force)`);await admin.end();}
});
