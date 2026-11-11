import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

const adminUrl=process.env.NOTIFICATION_DELIVERY_TEST_ADMIN_URL;
test('active notification queues leave accepted and unknown deliveries for explicit queries; license pushes stay disabled', {skip:!adminUrl}, async()=>{
  const url=new URL(adminUrl);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
  const name=`notification_delivery_${randomUUID().replaceAll('-','')}`;
  const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
  let database;
  try {
    await admin.query(`create database "${name}"`);url.pathname=`/${name}`;
    process.env.DATABASE_URL=url.toString();
    database=new pg.Client({connectionString:url.toString()});await database.connect();
    const dispatch=await import('../server/repositories/dispatchNotificationRepository.mjs');
    const procurement=await import('../server/repositories/procurementNotificationRepository.mjs');
    const trip=await import('../server/repositories/vehicleTripNotificationRepository.mjs');
    const license=await import('../server/repositories/vehicleLicenseNotificationRepository.mjs');
    const insurance=await import('../server/repositories/vehicleInsuranceRepository.mjs');
    const queues=[
      ['dispatch_notifications',()=>dispatch.claimNotification(database),(row,result)=>dispatch.finishNotification(row,result,database)],
      ['procurement_notifications',()=>procurement.claimDelivery(database),(row,result)=>procurement.finishDelivery(row,result,database)],
      ['vehicle_trip_notifications',()=>trip.claimTripDelivery(database),(row,result)=>trip.finishTripDelivery(row,result,database)],
      ['vehicle_insurance_notifications',()=>insurance.claimInsurance(database),(row,result)=>insurance.finishInsurance(database,row,result)]
    ];
    for(const table of [...queues.map(([table])=>table),'vehicle_license_exception_notifications'])await database.query(`create table ${table} (
      id text primary key,status text default 'pending',task_id text,error text default '',retryable boolean default false,
      attempts integer default 0,polls integer default 0,next_attempt_at timestamptz default now(),
      locked_until timestamptz,lease_id uuid,created_at timestamptz default now(),updated_at timestamptz default now(),insurance_end date default current_date
    )`);
    await database.query(await readFile('supabase/migrations/202611110001_manual_notification_results.sql','utf8'));
    await database.query("insert into vehicle_license_exception_notifications(id,status,task_id) values ('accepted','accepted','old-task'),('unknown','unknown','uncertain-task'),('pending','pending',null)");
    assert.equal(await license.claimLicenseDelivery(database),undefined,'even old pending license notices cannot be delivered');
    assert.equal((await database.query("select attempts from vehicle_license_exception_notifications where id='pending'")).rows[0].attempts,0);
    for(const [table,claim,finish] of queues) {
      await database.query(`insert into ${table}(id,status,task_id) values ('accepted','accepted','old-task'),('uncertain','unknown','other-task'),('lost','unknown',null),('new','pending',null)`);
      const row=await claim();assert.equal(row.id,'new',table);assert.equal(row.status,'unknown');
      assert.equal(await claim(),undefined,`${table}: prior accepted/unknown records cannot trigger any work`);
      await finish({...row,lease_id:randomUUID()},{status:'sent'});
      assert.equal((await database.query(`select status from ${table} where id='new'`)).rows[0].status,'unknown');
      await finish(row,{status:'accepted',taskId:'new-task',deliveryUserId:'original-account'});
      const saved=(await database.query(`select * from ${table} where id='new'`)).rows[0];
      assert.equal(saved.status,'accepted');assert.equal(saved.next_attempt_at,null);
      assert.equal(saved.delivery_user_id,'original-account');assert.ok(saved.delivery_submitted_at);assert.equal(saved.result_queried_at,null);
      await database.query(`update ${table} set next_attempt_at=now(),locked_until=null`);
      assert.equal(await claim(),undefined,`${table}: restart or an old next_attempt_at never resumes polling`);
      await database.query(`insert into ${table}(id) values('retry')`);
      const retry=await claim();await finish(retry,{status:'failed',error:'temporary',retryable:true});
      const pending=(await database.query(`select * from ${table} where id='retry'`)).rows[0];
      assert.equal(pending.status,'pending');assert.ok(pending.next_attempt_at>new Date());
    }
  } finally {
    if(database)await database.end();
    await admin.query(`drop database if exists "${name}" with (force)`);await admin.end();
  }
});
