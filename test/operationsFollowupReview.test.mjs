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
  const car=await service.saveVehicle(manager,{plate:'鲁BTEST01',brand:'测试',model:'出车占用',insuranceStart:'2020-01-01',insuranceEnd:'2099-12-31'});
  const otherCar=await service.saveVehicle(manager,{plate:'鲁BTEST02',brand:'测试',model:'独立车辆',insuranceStart:'2020-01-01',insuranceEnd:'2099-12-31'});
  const imageBase64=(await sharp({create:{width:40,height:20,channels:3,background:'#102030'}}).png().toBuffer()).toString('base64');
  async function request(user,vehicleId){const trip=await service.create(user,{...key(),vehicleId,reason:'隔离库出车测试',departurePhotos:[imageBase64]});return service.act(manager,trip.id,'approve',key());}
  async function photo(user,tripId,stage){
   const id=`file_${randomUUID()}`;
   await pool.query("insert into files(id,kind,storage_provider,bucket,object_key,mime_type,size_bytes,uploaded_by) values($1,$2,'local','','test-fixture','image/jpeg',8,$3)",[id,stage==='departure'?'trip_departure_photo':'trip_return_photo',user.id]);
   await pool.query('insert into vehicle_trip_attachments(file_id,trip_id,stage,uploaded_by) values($1,$2,$3,$4)',[id,tripId,stage,user.id]);
   return id;
  }
  let a;
  await t.test('approval immediately departs and a duplicate request preserves its time',async()=>{
   const input={...key(),vehicleId:car.id,reason:'自动出车',departurePhotos:[imageBase64]};
   const results=await Promise.all([service.create(first,input),service.create(first,input)]);
   a=results[0];assert.equal(a.status,'待审批');assert.equal(a.departureAt,undefined);
   assert.equal(results[1].id,a.id);
   a=await service.act(manager,a.id,'approve',key());assert.equal(a.status,'用车中');assert.ok(a.departureAt);
  });
  await t.test('an occupied vehicle rejects a new application without records or events',async()=>{
   const input={...key(),vehicleId:car.id,reason:'应拒绝',departurePhotos:[imageBase64]};
   await assert.rejects(()=>service.create(second,input),error=>error.status===409);
   assert.equal((await service.list(second)).length,0);
   assert.equal((await pool.query('select 1 from vehicle_trip_operations where actor_id=$1 and request_id=$2',[second.id,input.requestId])).rowCount,0);
   assert.equal((await pool.query('select 1 from vehicle_trip_notification_jobs where actor_id=$1 and request_id=$2',[second.id,input.requestId])).rowCount,0);
  });
  await t.test('another vehicle remains available',async()=>{
   assert.equal((await request(second,otherCar.id)).status,'用车中');
  });
  await t.test('submitting return immediately releases occupation',async()=>{
   const submitted=await service.act(first,a.id,'return',{...key(),fileIds:[await photo(first,a.id,'return')]});
   assert.equal(submitted.status,'已还车');
   assert.equal((await request(second,car.id)).status,'用车中');
   assert.equal((await service.detail(first,a.id)).status,'已还车');
  });
  await t.test('concurrent applications on one vehicle have exactly one winner',async()=>{
   const raceCar=await service.saveVehicle(manager,{plate:'鲁BTEST03',brand:'测试',model:'并发占用',insuranceStart:'2020-01-01',insuranceEnd:'2099-12-31'});
   const results=await Promise.allSettled([request(first,raceCar.id),request(second,raceCar.id)]);
   assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
   assert.equal(results.find(result=>result.status==='rejected').reason.status,409);
   assert.equal((await pool.query("select count(*)::integer as total from vehicle_trip_requests where vehicle_id=$1 and status='用车中'",[raceCar.id])).rows[0].total,1);
   const id=results.find(result=>result.status==='fulfilled').value.id;
   assert.equal((await pool.query("select count(*)::integer as total from vehicle_trip_notification_jobs where trip_id=$1 and action='approve'",[id])).rows[0].total,1);
  });
  await testProxyReturns(t, { pool, service, first, second, manager, imageBase64, key });
 } finally {
  await pool?.end();await Promise.all(connectionsClosed);
  await admin.query(`drop database if exists "${dbName}" with (force)`);await admin.end();
  await fs.rm(uploads,{recursive:true,force:true});
 }
});

async function testProxyReturns(t, { pool, service, first, second, manager, imageBase64, key }) {
  const manager2 = { ...manager, id: 'proxy-manager-2', name: '第二位管理员' };
  const outside = { ...manager, id: 'proxy-outside', shopId: 'other-shop' };
  const namesake = { ...first, id: 'proxy-namesake' };
  for (const user of [manager2, outside, namesake]) {
    await pool.query('insert into users(id,name,role,roles,shop_id,active) values($1,$2,$3,array[$3],$4,true)',
      [user.id, user.name, user.role, user.shopId]);
  }
  const car = await service.saveVehicle(manager, { plate: '鲁BTEST04', brand: '测试', model: '还车补登记',
    insuranceStart: '2020-01-01', insuranceEnd: '2099-12-31' });
  const create = user => service.create(user, { ...key(), vehicleId: car.id, reason: '核对补登记', departurePhotos: [imageBase64] });
  const approve = trip => service.act(manager2, trip.id, 'approve', key());
  const upload = (user, id) => service.upload(user, id, { ...key(), stage: 'return', imageBase64 });
  const proxy = (user, id, input = key()) => service.act(user, id, 'proxy-return', input);
  const rejects = (promise, status) => assert.rejects(promise, error => error.status === status);

  await t.test('a manager can clear an occupied trip without a photo, with one audit entry and no automatic approval', async () => {
    const current = await create(first);
    const next = await create(second);
    await approve(current);
    await assert.rejects(approve(next), error => error.status === 409 && error.details?.occupyingTripId === current.id);
    await assert.rejects(create(second), error => error.status === 409 && !error.details?.occupyingTripId);
    await rejects(proxy(second, current.id), 404);
    await rejects(proxy(first, current.id), 403);
    await rejects(proxy(outside, current.id), 404);
    await rejects(proxy({ ...manager, active: false }, current.id), 403);
    await rejects(proxy(manager, next.id), 409);

    const input = key();
    const [returned, retry] = await Promise.all([proxy(manager, current.id, input), proxy(manager, current.id, input)]);
    assert.equal(returned.status, '已还车');
    assert.equal(returned.proxyReturnedBy, manager.id);
    assert.equal(returned.proxyReturnedName, manager.name);
    assert.equal(returned.returnAt, retry.returnAt);
    await rejects(proxy(manager2, current.id), 409);
    await rejects(service.act(first, current.id, 'return', key()), 409);
    const detail = await service.detail(first, current.id);
    assert.equal(detail.history.filter(entry => entry.action === 'proxy-return').length, 1);
    assert.equal(detail.attachments.filter(photo => photo.stage === 'return').length, 0);
    assert.equal((await service.detail(manager, next.id)).status, '待审批');
    assert.equal((await approve(next)).status, '用车中');
    const ownPhoto = await upload(second, next.id);
    await service.act(second, next.id, 'return', { ...key(), fileIds: [ownPhoto.fileId] });
    await rejects(proxy(manager, next.id), 409);
    const replacement = await create(manager);
    await approve(replacement);
    await rejects(proxy(manager, replacement.id), 403);
    await rejects(service.act(manager, replacement.id, 'return', key()), 400);
    await proxy(manager2, replacement.id);
  });

  await t.test('proxy photos belong to the submitting manager, trip and round', async () => {
    const trip = await approve(await create(first));
    const previous = await upload(manager, trip.id);
    await pool.query('update vehicle_trip_requests set return_round=return_round+1 where id=$1', [trip.id]);
    const own = await upload(first, trip.id);
    const anotherManager = await upload(manager2, trip.id);
    const selected = await upload(manager, trip.id);
    const confirm = ids => proxy(manager, trip.id, { ...key(), fileIds: ids });
    for (const invalid of [own.fileId, anotherManager.fileId, previous.fileId]) {
      await rejects(confirm([selected.fileId, invalid]), 400);
    }
    await rejects(service.act(first, trip.id, 'return', { ...key(), fileIds: [selected.fileId] }), 400);
    await rejects(proxy(manager, trip.id, { ...key(), fileIds: [selected.fileId], returnRound: 1 }), 409);
    await rejects(service.authorizeFile(first, selected.fileId), 404);
    assert.equal((await service.detail(first, trip.id)).status, '用车中');
    await confirm([selected.fileId]);
    const detail = await service.detail(first, trip.id);
    assert.deepEqual(detail.attachments.filter(photo => photo.stage === 'return' && photo.confirmed).map(photo => photo.fileId), [selected.fileId]);
    const evidence = await pool.query('select uploaded_by from vehicle_trip_attachments where file_id=$1 and confirmed', [selected.fileId]);
    assert.equal(evidence.rows[0].uploaded_by, manager.id);
    await service.authorizeFile(first, selected.fileId);
    await rejects(service.authorizeFile(outside, selected.fileId), 404);
    const next = await approve(await create(first));
    await rejects(proxy(manager, next.id, { ...key(), fileIds: [selected.fileId] }), 400);
    await proxy(manager, next.id);
  });

  await t.test('concurrent return attempts leave one final status and at most one missed return', async () => {
    for (const applicantReturns of [true, false]) {
      const trip = await approve(await create(first));
      const month = applicantReturns ? '2023-05' : '2023-06';
      await pool.query('update vehicle_trip_requests set departure_at=$2 where id=$1', [trip.id, month + '-02T00:00:00Z']);
      const ownPhoto = await upload(first, trip.id);
      const competing = applicantReturns
        ? service.act(first, trip.id, 'return', { ...key(), fileIds: [ownPhoto.fileId] })
        : proxy(manager2, trip.id);
      const outcomes = await Promise.allSettled([competing, proxy(manager, trip.id)]);
      assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(outcomes.find(result => result.status === 'rejected').reason.status, 409);
      const detail = await service.detail(first, trip.id);
      const closed = detail.history.filter(entry => ['return', 'proxy-return'].includes(entry.action));
      assert.equal(closed.length, 1);
      assert.equal(detail.status, '已还车');
      assert.equal(Boolean(detail.proxyReturnedBy), closed[0].action === 'proxy-return');
      assert.equal(detail.attachments.some(photo => photo.stage === 'return' && photo.confirmed), closed[0].action === 'return');
      const report = await service.missedReturns(manager, { month, applicantId: first.id });
      assert.equal(report.total, closed[0].action === 'proxy-return' ? 1 : 0);
    }
  });

  await t.test('missed returns are attributed once to the local departure month and applicant, with authorized paged detail', async () => {
    async function closeAt(user, departureAt, normal = false) {
      const trip = await approve(await create(user));
      await pool.query('update vehicle_trip_requests set departure_at=$2 where id=$1', [trip.id, departureAt]);
      if (normal) {
        const photo = await upload(user, trip.id);
        await service.act(user, trip.id, 'return', { ...key(), fileIds: [photo.fileId] });
      } else {
        await proxy(manager, trip.id);
      }
      return trip.id;
    }
    const november = await closeAt(first, '2024-11-30T15:59:59.999Z');
    const december1 = await closeAt(first, '2024-11-30T16:00:00Z');
    const december2 = await closeAt(first, '2024-12-31T15:59:59.999Z');
    await closeAt(namesake, '2024-12-05T00:00:00Z');
    await closeAt(first, '2024-12-06T00:00:00Z', true);
    // Old completed trips can lack a return photo; only an explicit proxy return counts.
    await pool.query(`insert into vehicle_trip_requests
      (id, shop_id, applicant_id, applicant_name, vehicle_id, vehicle_snapshot, reason, status, departure_at, return_at)
      values ($1,$2,$3,$4,$5,'{}','历史还车','已还车','2024-12-07T00:00:00Z','2024-12-07T02:00:00Z')`,
      [randomUUID(), first.shopId, first.id, first.name, car.id]);
    const report = (user, month, query = {}) => service.missedReturns(user, { month, ...query });
    const novemberReport = await report(manager, '2024-11');
    assert.deepEqual(novemberReport.items, [{ applicantId: first.id, applicantName: first.name, count: 1 }]);
    const decemberReport = await report(manager, '2024-12');
    assert.deepEqual(Object.fromEntries(decemberReport.items.map(row => [row.applicantId, row.count])), { [first.id]: 2, [namesake.id]: 1 });
    for (const query of [{}, { applicantId: first.id }]) {
      await rejects(report(first, '2024-12', query), 403);
      assert.deepEqual((await report(outside, '2024-12', query)).items, []);
    }
    await rejects(report(manager, '2024-13'), 400);
    const pages = await Promise.all([1, 2].map(page => report(manager, '2024-12', { applicantId: first.id, page, pageSize: 1 })));
    assert.ok(pages.every(result => result.total === 2 && result.items.length === 1));
    assert.deepEqual(pages.map(result => result.items[0].id).sort(), [december1, december2].sort());
    const novemberDetail = await report(manager, '2024-11', { applicantId: first.id, page: 1, pageSize: 20 });
    assert.equal(novemberDetail.items[0].id, november);
    assert.equal(novemberDetail.items[0].vehicle.plate, car.plate);
    assert.equal(novemberDetail.items[0].proxyReturnedBy, manager.id);
    assert.ok(novemberDetail.items[0].returnAt > novemberDetail.items[0].departureAt);

    const pending = await create(second);
    const inUse = await approve(await create(second));
    await pool.query("update vehicle_trip_requests set created_at='2024-12-10' where id=$1", [pending.id]);
    await pool.query("update vehicle_trip_requests set departure_at='2024-12-11' where id=$1", [inUse.id]);
    const month = { month: '2024-12' };
    const usage = await service.usage(manager, month);
    assert.deepEqual(usage.items.map(row => [row.applicantId, row.tripCount, row.missedReturnCount]).sort(), [
      [first.id, 4, 2], [namesake.id, 1, 1], [second.id, 1, 0]
    ].sort());
    const active = await service.usage(manager, { ...month, applicantId: second.id });
    assert.deepEqual(active.items.map(row => [row.id, row.status]), [[inUse.id, '用车中']]);
    assert.equal((await service.usage(manager, { month: '2024-11' })).items[0].tripCount, 1);
    for (const query of [month, { ...month, applicantId: first.id }]) {
      await rejects(service.usage(second, query), 403);
      assert.deepEqual((await service.usage(outside, query)).items, []);
    }
  });
}
