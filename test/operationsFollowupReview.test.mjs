import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const adminUrl=process.env.DISPATCH_TEST_ADMIN_URL;
test('vehicle occupancy is exclusive across applications and released on return',{skip:!adminUrl,timeout:120000},async t=>{
 const url=new URL(adminUrl);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
 const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
 const uploads=await fs.mkdtemp(path.join(os.tmpdir(),'trip-occupancy-'));
 const dbName=`operations_review_${process.pid}_${Date.now()}`,connectionsClosed=[];let pool;
 try {
  await admin.query(`create database "${dbName}"`);url.pathname=`/${dbName}`;
  Object.assign(process.env,{DATABASE_URL:url.toString(),APP_ENV:'test',DISPATCH_NOTIFICATION_MODE:'mock',RUNFENG_REPAIR_WRITEBACK_ENABLED:'false',FILE_STORAGE_PROVIDER:'local',LOCAL_UPLOAD_ROOT:uploads});
  pool=(await import('../server/database/pool.mjs')).pool;
  pool.on('connect',client=>connectionsClosed.push(new Promise(resolve=>client.once('end',resolve))));
  for(const file of (await fs.readdir('supabase/migrations')).filter(file=>file.endsWith('.sql')&&file!=='202608070005_remove_obsolete_runfeng_sync_role.sql').sort())await pool.query(await fs.readFile(`supabase/migrations/${file}`,'utf8'));
  const first={id:'occupancy-a',name:'甲',role:'employee',shopId:'shop-hq',active:true};
  const second={...first,id:'occupancy-b',name:'乙'};
  const manager={...first,id:'occupancy-manager',name:'管理员',role:'manager'};
  for(const user of [first,second,manager])await pool.query('insert into users(id,name,role,roles,shop_id,active) values($1,$2,$3,array[$3],$4,true)',[user.id,user.name,user.role,user.shopId]);
  const {vehicleTripService:service}=await import('../server/services/vehicleTripService.mjs');
  const key=()=>({requestId:randomUUID()});
  const car=await service.saveVehicle(manager,{plate:'鲁BTEST01',brand:'测试',model:'出车占用'});
  const otherCar=await service.saveVehicle(manager,{plate:'鲁BTEST02',brand:'测试',model:'独立车辆'});
  const imageBase64=(await sharp({create:{width:40,height:20,channels:3,background:'#102030'}}).png().toBuffer()).toString('base64');
  async function request(user,vehicleId){return service.create(user,{...key(),vehicleId,reason:'隔离库出车测试',departurePhotos:[imageBase64]});}
  async function photo(user,tripId,stage){
   const id=`file_${randomUUID()}`;
   await pool.query("insert into files(id,kind,storage_provider,bucket,object_key,mime_type,size_bytes,uploaded_by) values($1,$2,'local','','test-fixture','image/jpeg',8,$3)",[id,stage==='departure'?'trip_departure_photo':'trip_return_photo',user.id]);
   await pool.query('insert into vehicle_trip_attachments(file_id,trip_id,stage,uploaded_by) values($1,$2,$3,$4)',[id,tripId,stage,user.id]);
   return id;
  }
  async function departure(user,trip){return key();}
  let a,b,aDeparture,bDeparture;
  await t.test('multiple applications can wait for approval and departure',async()=>{
   a=await request(first,car.id);b=await request(second,car.id);
   assert.equal(a.status,'待审批');assert.equal(b.status,'待审批');
   a=await service.act(manager,a.id,'approve',key());b=await service.act(manager,b.id,'approve',key());
   assert.equal(a.status,'待出车');assert.equal(b.status,'待出车');
   aDeparture=await departure(first,a);bDeparture=await departure(second,b);
  });
  await t.test('a second application cannot depart an occupied vehicle, and rejection rolls back',async()=>{
   const departed=await service.act(first,a.id,'depart',aDeparture);assert.equal(departed.status,'用车中');
   await assert.rejects(()=>service.act(second,b.id,'depart',bDeparture),error=>error.status===409&&/使用中/.test(error.message));
   assert.equal((await service.detail(second,b.id)).status,'待出车');
   assert.equal((await service.detail(second,b.id)).attachments[0].confirmed,true,'application photo remains submitted when departure is blocked');
   assert.equal((await pool.query('select 1 from vehicle_trip_operations where actor_id=$1 and request_id=$2',[second.id,bDeparture.requestId])).rowCount,0);
   assert.equal((await pool.query("select 1 from vehicle_trip_notification_jobs where trip_id=$1 and action='depart'",[b.id])).rowCount,0);
   assert.equal((await service.act(first,a.id,'depart',aDeparture)).departureAt,departed.departureAt);
  });
  await t.test('another vehicle remains available while the first is occupied',async()=>{
   const trip=await request(second,otherCar.id);await service.act(manager,trip.id,'approve',key());
   assert.equal((await service.act(second,trip.id,'depart',await departure(second,trip))).status,'用车中');
  });
  await t.test('return releases the vehicle and the rejected departure can be retried',async()=>{
   await service.act(first,a.id,'return',{...key(),fileIds:[await photo(first,a.id,'return')]});
   const next=await service.act(second,b.id,'depart',bDeparture);assert.equal(next.status,'用车中');
   assert.equal((await service.detail(first,a.id)).status,'已还车');
   assert.equal((await pool.query("select count(*)::integer as total from vehicle_trip_requests where vehicle_id=$1 and status='用车中'",[car.id])).rows[0].total,1);
  });
  await t.test('concurrent departures on the same vehicle allow exactly one application',async()=>{
   const raceCar=await service.saveVehicle(manager,{plate:'鲁BTEST03',brand:'测试',model:'并发占用'});
   const trips=await Promise.all([request(first,raceCar.id),request(second,raceCar.id)]);
   await Promise.all(trips.map(trip=>service.act(manager,trip.id,'approve',key())));
   const users=[first,second],inputs=await Promise.all(trips.map((trip,index)=>departure(users[index],trip)));
   const results=await Promise.allSettled(trips.map((trip,index)=>service.act(users[index],trip.id,'depart',inputs[index])));
   assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
   const failed=results.find(result=>result.status==='rejected');assert.equal(failed.reason.status,409);
   assert.equal((await pool.query("select count(*)::integer as total from vehicle_trip_requests where vehicle_id=$1 and status='用车中'",[raceCar.id])).rows[0].total,1);
   assert.equal((await pool.query("select count(*)::integer as total from vehicle_trip_notification_jobs where trip_id=any($1::text[]) and action='depart'",[trips.map(trip=>trip.id)])).rows[0].total,1);
  });
 } finally {
  await pool?.end();await Promise.all(connectionsClosed);
  await admin.query(`drop database if exists "${dbName}" with (force)`);await admin.end();
  await fs.rm(uploads,{recursive:true,force:true});
 }
});
