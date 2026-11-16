import test from 'node:test';import assert from 'node:assert/strict';import pg from 'pg';import {readdir,readFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';
const adminUrl=process.env.INBOX_TEST_ADMIN_URL;
test('pending lifecycle persists committed transitions, excludes history, deduplicates and revalidates', {skip:!adminUrl,timeout:120000},async()=>{
 const url=new URL(adminUrl);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));
 const admin=new pg.Client({connectionString:adminUrl});await admin.connect();const name='pending_'+randomUUID().replaceAll('-','');let db,pool;
 try{
 await admin.query(`create database "${name}"`);url.pathname='/'+name;process.env.DATABASE_URL=url.toString();
 db=new pg.Client({connectionString:url.toString()});await db.connect();
 const files=(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f!=='202608070005_remove_obsolete_runfeng_sync_role.sql').sort();
 for(const f of files.filter(f=>!f.startsWith('20261115')))await db.query(await readFile('supabase/migrations/'+f,'utf8'));
 for(const [id,role] of [['a','advisor'],['m','manager'],['i','inspector']])await db.query("insert into users(id,name,role,roles,shop_id,dingtalk_user_id) values($1,$1,$2,array[$2],'shop-hq',$1)",[id,role]);
 const order=async(id,status='已委托')=>db.query("insert into work_orders(id,status,advisor,technician,inspector,shop_id,old_parts_handling,vehicle_plate) values($1,$2,'a','','','shop-hq','客户带走','鲁B测试')",[id,status]);
 await order('old');for(const f of files.filter(f=>f.startsWith('20261115')))await db.query(await readFile('supabase/migrations/'+f,'utf8'));
 ({pool}=await import('../server/database/pool.mjs'));
 const repo=await import('../server/repositories/pendingReminderRepository.mjs');
 const {deliverPendingDigest}=await import('../server/workers/pendingReminders.mjs');
 const run=async fn=>{await db.query('begin');try{const value=await fn(db);await db.query('commit');return value;}catch(e){await db.query('rollback');throw e;}};
 const project=async()=>{while(await repo.projectPendingEvents(run)){};};
 await project();assert.equal((await db.query("select eligible from personal_pending_subjects where target_id='old'")).rows[0].eligible,false);
 await db.query("update work_orders set advisor='m' where id='old'");await project();assert.equal((await db.query("select eligible from personal_pending_subjects where target_id='old'")).rows[0].eligible,false);
 await order('new');await project();let subject=(await db.query("select * from personal_pending_subjects where target_id='new' and closed_at is null")).rows[0];assert.equal(subject.eligible,true);
 await db.query("update work_orders set fault_description='edit' where id='new'");await project();assert.equal((await db.query('select entered_at from personal_pending_subjects where id=$1',[subject.id])).rows[0].entered_at.toISOString(),subject.entered_at.toISOString());
 const now=new Date('2026-11-16T01:00:00Z');await db.query('update personal_pending_subjects set next_reminder_at=$2 where id=$1',[subject.id,now]);
 await repo.queuePendingReminders(now,run);await repo.queuePendingReminders(now,run);
 assert.deepEqual((await db.query('select recipient_id,level from personal_pending_deliveries')).rows,[{recipient_id:'a',level:0}]);
 let sent=0;const options={database:db,env:{APP_ENV:'test',DISPATCH_NOTIFICATION_MODE:'mock'},claim:()=>repo.claimPendingDigest(run),send:async()=>{sent++;return {status:'accepted',taskId:'test'};}};
 // A crashed preparation is reclaimable; an expired worker cannot seal or overwrite its successor.
 const abandoned=await repo.claimPendingDigest(run);assert.equal(abandoned.length,1);
 assert.equal((await repo.claimPendingDigest(run)).length,0);
 await db.query("update personal_pending_deliveries set lease_until=now()-interval '1 second' where id=$1",[abandoned[0].id]);
 const reclaimed=await repo.claimPendingDigest(run);assert.equal(reclaimed.length,1);assert.notEqual(reclaimed[0].lease_id,abandoned[0].lease_id);
 assert.equal(await repo.sealPendingDigest(db,abandoned),false);
 await repo.finishPendingDelivery(db,abandoned[0],{status:'cancelled'});
 assert.equal((await db.query('select status from personal_pending_deliveries where id=$1',[abandoned[0].id])).rows[0].status,'pending');
 await repo.finishPendingDelivery(db,reclaimed[0],{status:'pending'});
 await deliverPendingDigest(options);assert.equal(sent,1);assert.equal(await deliverPendingDigest(options),false);
 await repo.queuePendingReminders(new Date('2026-11-16T03:00:00Z'),run);
 assert.deepEqual((await db.query('select recipient_id from personal_pending_deliveries where level=1 order by recipient_id')).rows,[{recipient_id:'a'},{recipient_id:'m'}]);
 await db.query("update work_orders set status='完成' where id='new'"); // No projection yet: sending must still read live business state.
 while(await deliverPendingDigest({...options,send:async()=>assert.fail('completed must not send')})){}
 await project();assert.ok((await db.query('select closed_at from personal_pending_subjects where id=$1',[subject.id])).rows[0].closed_at);
 await db.query("update work_orders set status='待客户签字' where id='old'");await project();assert.equal((await db.query("select eligible from personal_pending_subjects where target_id='old' and closed_at is null")).rows[0].eligible,true);
 // A transaction that leaves the same final state must not create a new round.
 const before=(await db.query("select id from personal_pending_subjects where target_id='old' and closed_at is null")).rows[0].id;
 await run(async()=>{await db.query("update work_orders set status='已委托' where id='old'");await db.query("update work_orders set status='待客户签字' where id='old'");});await project();assert.equal((await db.query("select id from personal_pending_subjects where target_id='old' and closed_at is null")).rows[0].id,before);
 // Daily reminders are once per business day and return to the handler.
 await db.query("update personal_pending_subjects set next_reminder_at=null where target_id='old'");
 await order('daily');await project();const daily=(await db.query("select id from personal_pending_subjects where target_id='daily' and closed_at is null")).rows[0];
 await db.query('update personal_pending_subjects set next_reminder_at=$2 where id=$1',[daily.id,now]);
 await repo.queuePendingReminders(now,run);await repo.queuePendingReminders(new Date('2026-11-16T03:00:00Z'),run);
 await repo.queuePendingReminders(new Date('2026-11-17T00:00:00Z'),run);await repo.queuePendingReminders(new Date('2026-11-17T01:00:00Z'),run);
 assert.deepEqual((await db.query('select recipient_id,stage from personal_pending_deliveries where subject_id=$1 and level=2',[daily.id])).rows,[{recipient_id:'a',stage:'2026-11-17'}]);
 // The manager sees an escalated action, but reading its result never completes it.
 const {readPersonalWorkbench,readInbox,markInboxRead}=await import('../server/repositories/personalWorkbenchRepository.mjs');
 const manager={id:'m',name:'m',role:'manager',roles:['manager'],shopId:'shop-hq',active:true};
 const center=await readPersonalWorkbench(manager,db);assert.ok(center.todos.some(t=>t.targetId==='daily'&&t.category==='待派工'));
 await db.query("insert into personal_inbox(event_key,recipient_id,shop_id,title,target_key,target_id) values('test-action','m','shop-hq','待检验','dispatchOrder','daily'),('test-result','m','shop-hq','出车申请已批准','vehicleTrip','trip')");
 assert.equal((await readInbox(manager,{resultsOnly:true,unread:true},db)).items.length,1);
 await markInboxRead(manager,{through:'999999'},db);assert.ok((await readPersonalWorkbench(manager,db)).todos.some(t=>t.targetId==='daily'));
 // Own approval waits are tracking items, never actionable badge counts.
 await db.query("insert into vehicle_trip_requests(id,shop_id,applicant_id,applicant_name,vehicle_id,vehicle_snapshot,reason) values('trip','shop-hq','m','m','cv_60778','{\"plate\":\"鲁B60778\"}','test')");await project();
 const tracked=await readPersonalWorkbench(manager,db);assert.equal(tracked.following.length,1);assert.equal(tracked.todos.some(t=>t.targetId==='trip'),false);
 // Unknown submission is terminal, including restarts.
 await deliverPendingDigest({...options,send:async()=>{throw Error('ambiguous transport');}});
 assert.ok((await db.query("select count(*)::int n from personal_pending_deliveries where status='unknown'")).rows[0].n>0);
 await db.query('begin');await order('rolled-back');await db.query('rollback');await project();assert.equal((await db.query("select count(*)::int n from personal_pending_subjects where target_id='rolled-back'")).rows[0].n,0);
 }finally{await db?.end();await pool?.end();await admin.query(`drop database if exists "${name}" with (force)`);await admin.end();}
});
