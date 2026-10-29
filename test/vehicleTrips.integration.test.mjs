import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import pg from 'pg';
import sharp from 'sharp';
const adminUrl = process.env.DISPATCH_TEST_ADMIN_URL;

test('company fleet and vehicle trips: migrations, auth, transaction retries, photos and isolation', { skip: !adminUrl, timeout: 120000 }, async () => {
  const url = new URL(adminUrl); assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  const admin = new pg.Client({ connectionString: adminUrl }); await admin.connect();
  const name = `vehicle_trips_${process.pid}_${Date.now()}`;
  const uploads = await fs.mkdtemp(path.join(os.tmpdir(), 'trip-uploads-'));
  let pool, server;
  try {
    await admin.query(`create database "${name}"`); url.pathname = `/${name}`;
    Object.assign(process.env, { DATABASE_URL: url.toString(), APP_ENV: 'development', DISPATCH_NOTIFICATION_MODE: 'mock', ENABLE_DEV_AUTH: 'true', JWT_SECRET: 'isolated-vehicle-trip-test-secret', FILE_STORAGE_PROVIDER: 'local', LOCAL_UPLOAD_ROOT: uploads });
    pool = (await import('../server/database/pool.mjs')).pool;
    for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql') && f !== '202608070005_remove_obsolete_runfeng_sync_role.sql').sort()) await pool.query(await fs.readFile(`supabase/migrations/${file}`, 'utf8'));
    const { vehicleTripService: svc, prepareTripImage } = await import('../server/services/vehicleTripService.mjs');
    const { loginForDevelopment } = await import('../server/auth.mjs');
    const unassigned = await loginForDevelopment('unassigned'); assert.equal(unassigned.user.role, 'employee');
    const employee = (await loginForDevelopment('employee')).user;
    const manager = (await loginForDevelopment('manager')).user;
    const other = { ...employee, id: 'other' }, manager2 = { ...manager, id: 'manager2' }, stranger = { ...manager, id: 'stranger', shopId: 'other-shop' };
    const technician = { ...employee, id: 'unbound', role: 'technician' };
    for (const user of [other, manager2, stranger, technician]) await pool.query('insert into users(id,name,role,shop_id,roles) values($1,$2,$3,$4,array[$3])', [user.id, user.name, user.role, user.shopId]);
    const fails = (promise, code) => assert.rejects(() => promise, e => e.status === code);
    const key = () => ({ requestId: randomUUID() });
    const cars = await svc.vehicles(employee); assert.equal(cars.length, 8);
    assert.deepEqual(cars.map(v => v.plate).sort(), ['鲁B60778','鲁BDT7922','鲁BDS3250','鲁BDQ2235','鲁BD56565','鲁BB62767','鲁BD09326','鲁BA86281'].sort());
    await fails(svc.saveVehicle(employee, { plate: '鲁BTEST', brand: '测试', model: '测试' }), 403);
    const car = await svc.saveVehicle(manager, { plate: ' 鲁 btest ', brand: '测试', model: '测试' }); assert.equal(car.plate, '鲁BTEST');
    await fails(svc.saveVehicle(manager, { plate: '鲁BTEST', brand: '其他', model: '其他' }), 409);
    await fails(svc.saveVehicle(stranger, car, car.id), 404);
    const input = { ...key(), vehicleId: car.id, reason: '外出办事', note: '' };
    const [trip, retry] = await Promise.all([svc.create(employee, input), svc.create(employee, input)]); assert.equal(trip.id, retry.id);
    await fails(svc.create(employee, { ...input, reason: '更改' }), 409);
    await svc.saveVehicle(manager, { ...car, model: '新车型' }, car.id);
    assert.equal((await svc.detail(employee, trip.id)).vehicle.model, '测试');
    assert.equal((await svc.list(other)).length, 0); assert.equal((await svc.list(stranger)).length, 0);
    await fails(svc.detail(other, trip.id), 404); await fails(svc.detail(stranger, trip.id), 404);
    await fails(svc.act(employee, trip.id, 'depart', key()), 409);
    const own = await svc.create(manager, { ...key(), vehicleId: car.id, reason: '管理员本人申请' });
    await fails(svc.act(manager, own.id, 'approve', key()), 403);
    await fails(svc.act(manager, own.id, 'reject', { ...key(), reason: '本人驳回' }), 403);
    await fails(prepareTripImage({ imageBase64: 'invalid' }, 'departure'), 400);
    const imageBase64 = (await sharp({ create: { width: 80, height: 40, channels: 3, background: '#102030' } }).png().toBuffer()).toString('base64');
    const upload = (user, id, stage) => svc.upload(user, id, { ...key(), stage, imageBase64 });
    await fails(upload(manager, trip.id, 'signature'), 400);
    const approvalRequest = key();
    const approvals = await Promise.allSettled([
      svc.act(manager, trip.id, 'approve', approvalRequest),
      svc.act(manager2, trip.id, 'approve', key())
    ]);
    assert.equal(approvals.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(approvals.find(r => r.status === 'rejected').reason.status, 409);
    const approved = await svc.detail(employee, trip.id); assert.equal(approved.status, '待出车');
    const winner = approvals[0].status === 'fulfilled' ? manager : manager2;
    assert.equal(approved.approvedBy, winner.id);
    assert.equal(approved.approvedName, winner.name);
    assert.ok(approved.approvedAt);
    assert.equal(approved.attachments.length, 0, '批准无需任何签字附件');
    if (winner.id === manager.id) assert.equal((await svc.act(manager, trip.id, 'approve', approvalRequest)).approvedAt, approved.approvedAt);
    await fails(svc.act(employee, trip.id, 'depart', key()), 400);
    const photoInput = { ...key(), stage: 'departure', imageBase64 };
    const photo = await svc.upload(employee, trip.id, photoInput);
    assert.equal((await svc.upload(employee, trip.id, photoInput)).fileId, photo.fileId);
    await fails(svc.authorizeFile(other, photo.fileId), 404); await fails(svc.authorizeFile(stranger, photo.fileId), 404);
    const another = await svc.create(employee, { ...key(), vehicleId: car.id, reason: '另一申请' });
    await svc.act(manager, another.id, 'approve', key());
    await fails(svc.act(employee, another.id, 'depart', { ...key(), fileIds: [photo.fileId] }), 400);
    await svc.saveVehicle(manager, { ...car, active: false }, car.id);
    assert.ok(!(await svc.vehicles(employee)).some(v => v.id === car.id));
    await fails(svc.create(employee, { ...key(), vehicleId: car.id, reason: '停用车辆' }), 409);
    await fails(svc.act(employee, trip.id, 'depart', { ...key(), fileIds: [photo.fileId] }), 409);
    await svc.saveVehicle(manager, { ...car, active: true }, car.id);
    const unusedPhoto = await upload(employee, trip.id, 'departure');
    const departInput = { ...key(), fileIds: [photo.fileId] };
    const departed = await svc.act(employee, trip.id, 'depart', departInput);
    assert.equal((await svc.act(employee, trip.id, 'depart', departInput)).departureAt, departed.departureAt);
    await fails(svc.act(employee, trip.id, 'cancel', key()), 409);
    await fails(svc.act(manager, trip.id, 'return', key()), 403);
    await svc.saveVehicle(manager, { ...car, active: false }, car.id);
    await fails(svc.act(employee, trip.id, 'return', key()), 400);
    const returnedPhoto = await upload(employee, trip.id, 'return'); const returnInput = { ...key(), fileIds: [returnedPhoto.fileId] };
    const returned = await svc.act(employee, trip.id, 'return', returnInput); assert.equal(returned.status, '已还车');
    assert.ok(!(await svc.detail(employee, trip.id)).attachments.some(a => a.fileId === unusedPhoto.fileId), '未选用照片不出现在最终凭证中');
    assert.equal((await svc.act(employee, trip.id, 'return', returnInput)).returnAt, returned.returnAt);
    assert.ok(new Date(returned.returnAt) >= new Date(returned.departureAt));
    await fails(upload(employee, trip.id, 'return'), 409);
    assert.deepEqual((await svc.detail(employee, trip.id)).history.map(h => h.action), ['create', 'approve', 'depart', 'return']);
    const rejected = await svc.create(employee, { ...key(), vehicleId: cars[0].id, reason: '待驳回' });
    await fails(svc.act(manager, rejected.id, 'reject', key()), 400);
    assert.equal((await svc.act(manager, rejected.id, 'reject', { ...key(), reason: '调整计划' })).status, '已驳回');
    assert.equal((await svc.act(employee, another.id, 'cancel', key())).status, '已取消');

    // Notification events are durable and share the operation's transaction/idempotency boundary.
    const notificationRepo=await import('../server/repositories/vehicleTripNotificationRepository.mjs');
    const {resolveTripRecipients,processTripNotification}=await import('../server/workers/vehicleTripNotifications.mjs');
    const {transaction}=await import('../server/database/pool.mjs');
    const queuedFor=async id=>(await pool.query('select * from vehicle_trip_notification_jobs where trip_id=$1 order by created_at',[id])).rows;
    assert.deepEqual((await queuedFor(trip.id)).map(j=>j.action),['create','approve','depart','return']);
    assert.equal((await queuedFor(trip.id)).filter(j=>j.action==='approve').length,1,'concurrent approval queues one event');
    assert.equal((await queuedFor(trip.id)).filter(j=>j.action==='create').length,1,'identical concurrent create queues one event');
    assert.ok((await queuedFor(trip.id)).every(j=>!j.action.startsWith('upload:')));
    const waiting=await svc.create(employee,{...key(),vehicleId:cars[0].id,reason:'通知审批测试'});
    for(let i=0;i<100;i++)if(!await resolveTripRecipients({database:pool,runTransaction:transaction}))break;
    const deliveries=async id=>(await pool.query('select n.*,j.action,j.trip_id from vehicle_trip_notifications n join vehicle_trip_notification_jobs j on j.id=n.job_id where j.trip_id=$1 order by n.created_at',[id])).rows;
    assert.deepEqual((await deliveries(trip.id)).map(n=>[n.action,n.recipient_id]),[['return',winner.id]],'obsolete create/approval/departure events do not send');
    const waitingTargets=(await deliveries(waiting.id)).map(n=>n.recipient_id);
    assert.ok(waitingTargets.includes(manager.id));assert.ok(waitingTargets.includes(manager2.id));
    assert.ok(!waitingTargets.includes(employee.id));assert.ok(!waitingTargets.includes(stranger.id));
    assert.ok((await deliveries(own.id)).every(n=>n.recipient_id!==manager.id),'manager cannot receive own approval reminder');
    assert.deepEqual((await deliveries(rejected.id)).map(n=>[n.action,n.recipient_id]),[['reject',employee.id]]);
    assert.ok((await deliveries(another.id)).every(n=>n.action==='cancel'));
    // Messages queued before someone else approves are revalidated immediately before sending.
    await svc.act(manager,waiting.id,'approve',key());
    const obsolete=(await deliveries(waiting.id))[0];let sent=0;
    await processTripNotification({database:pool,claim:async()=>({...obsolete,previous_status:'pending'}),finish:async(_,result)=>{assert.equal(result.status,'failed');assert.equal(result.retryable,false);},send:async()=>{sent++;}});
    assert.equal(sent,0);
    // Real leases, retry schedule, platform acceptance and result polling, with a mocked transport.
    await pool.query("update vehicle_trip_notifications set locked_until=now()+interval '1 hour'");
    const target=(await deliveries(trip.id))[0];await pool.query('update vehicle_trip_notifications set locked_until=null where id=$1',[target.id]);
    const [leaseA,leaseB]=await Promise.all([notificationRepo.claimTripDelivery(pool),notificationRepo.claimTripDelivery(pool)]);
    const claimed=leaseA||leaseB;assert.ok(claimed);assert.ok(!leaseA||!leaseB,'only one worker claims the target');
    await notificationRepo.finishTripDelivery({...claimed,lease_id:'stale'},{status:'sent'},pool);
    assert.equal((await pool.query('select status from vehicle_trip_notifications where id=$1',[target.id])).rows[0].status,'unknown');
    await notificationRepo.finishTripDelivery(claimed,{status:'failed',retryable:true,error:'钉钉限流'},pool);
    let saved=(await pool.query('select * from vehicle_trip_notifications where id=$1',[target.id])).rows[0];
    assert.equal(saved.status,'pending');assert.ok(saved.next_attempt_at>new Date());
    await pool.query('update vehicle_trip_notifications set next_attempt_at=now() where id=$1',[target.id]);
    let sends=0,queries=0;
    const transport={database:pool,send:async(notification,recipient)=>{sends++;assert.equal(notification.action,'return');assert.equal(notification.payload.id,trip.id);return {status:'accepted',taskId:'mock-trip-task'};},query:async()=>{queries++;return {status:'sent'};}};
    await processTripNotification(transport);
    await pool.query('update vehicle_trip_notifications set next_attempt_at=now() where id=$1',[target.id]);
    await processTripNotification(transport);
    saved=(await pool.query('select * from vehicle_trip_notifications where id=$1',[target.id])).rows[0];
    assert.equal(saved.status,'sent');assert.equal(sends,1);assert.equal(queries,1);
    // Production roster failures do not fall back to whichever managers have logged in locally.
    const rosterTrip=await svc.create(employee,{...key(),vehicleId:cars[0].id,reason:'通讯录故障测试'});
    await pool.query("update vehicle_trip_notification_jobs set locked_until=now()+interval '1 hour' where trip_id<>$1 and status='pending'",[rosterTrip.id]);
    const dingEnv={APP_ENV:'test',DISPATCH_NOTIFICATION_MODE:'dingtalk',DINGTALK_AGENT_ID:'123',DINGTALK_APP_KEY:'fake',DINGTALK_APP_SECRET:'fake',DISPATCH_APP_URL:'https://example.test'};
    await resolveTripRecipients({database:pool,runTransaction:transaction,env:dingEnv,sync:async()=>{throw new Error('通讯录不可用');}});
    let rosterJob=(await queuedFor(rosterTrip.id))[0];assert.equal(rosterJob.status,'pending');assert.match(rosterJob.error,/通讯录不可用/);assert.equal((await deliveries(rosterTrip.id)).length,0);
    await pool.query('update vehicle_trip_notification_jobs set next_attempt_at=now() where id=$1',[rosterJob.id]);
    await resolveTripRecipients({database:pool,runTransaction:transaction,env:dingEnv,sync:async()=>[manager2.id,stranger.id,employee.id]});
    assert.deepEqual((await deliveries(rosterTrip.id)).map(n=>n.recipient_id),[manager2.id]);
    // No other manager: retain a visible retryable resolution job, never notify the applicant themself.
    const soloTrip=await svc.create(manager,{...key(),vehicleId:cars[0].id,reason:'没有其他审批人'});
    await resolveTripRecipients({database:pool,runTransaction:transaction,env:dingEnv,sync:async()=>[manager.id]});
    assert.equal((await queuedFor(soloTrip.id))[0].status,'pending');assert.equal((await deliveries(soloTrip.id)).length,0);
    // Failure to save the notification rolls back the application and operation together.
    await pool.query("create function trip_notification_test_failure() returns trigger language plpgsql as $$ begin raise exception 'notification insert failure'; end $$");
    await pool.query('create trigger trip_notification_test_failure before insert on vehicle_trip_notification_jobs for each row execute function trip_notification_test_failure()');
    const rollback=key(),countBefore=(await svc.list(employee)).length;
    await assert.rejects(svc.create(employee,{...rollback,vehicleId:cars[0].id,reason:'应回滚'}),/notification insert failure/);
    assert.equal((await svc.list(employee)).length,countBefore);
    assert.equal((await pool.query('select 1 from vehicle_trip_operations where actor_id=$1 and request_id=$2',[employee.id,rollback.requestId])).rowCount,0);
    await pool.query('drop trigger trip_notification_test_failure on vehicle_trip_notification_jobs');

    // Exercise real HTTP middleware: basic users and unbound technicians must reach trips, but not legacy business routes.
    const { handleApiRequest } = await import('../server/routes/apiRouter.mjs');
    const { serveStatic } = await import('../server/http/staticFiles.mjs');
    const { createTokenForUser } = await import('../server/auth.mjs');
    const { createAuthSession } = await import('../server/repositories/userRepository.mjs');
    server = createServer(async (req, res) => {
      try { if (!await handleApiRequest(req, res, new URL(req.url, 'http://localhost'))) { if(process.env.VEHICLE_TRIP_UI_TEST==='true')await serveStatic(res,new URL(req.url,'http://localhost').pathname,path.resolve(process.env.DISPATCH_TEST_DIST_DIR||'dist'));else {res.statusCode = 404; res.end();} } }
      catch (e) { res.statusCode = e.status || 500; res.end(JSON.stringify({ error: e.message })); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function tokenFor(user) { const token = createTokenForUser(user.id); await createAuthSession({ token, userId: user.id, expiresAt: new Date(Date.now() + 60000) }); return token; }
    const token = await tokenFor(employee), techToken = await tokenFor(technician);
    const get = (route, bearer = token) => fetch(base + route, { headers: { Authorization: `Bearer ${bearer}` } });
    assert.equal((await get('/api/vehicle-trip-requests')).status, 200);
    assert.equal((await get('/api/company-vehicles', techToken)).status, 200);
    assert.equal((await get('/api/work-orders')).status, 403);
    assert.equal((await get('/api/users')).status, 403);
    assert.equal((await get('/api/work-orders', techToken)).status, 403);
    assert.equal((await get(`/api/files/${photo.fileId}/content`)).status, 200);
    assert.equal((await get(`/api/files/${photo.fileId}/content`, await tokenFor(other))).status, 404);
    assert.equal((await get(`/api/files/${photo.fileId}/content`, await tokenFor(stranger))).status, 404);
    assert.equal((await svc.create(technician, { ...key(), vehicleId: cars[0].id, reason: '未绑定员工也可申请' })).status, '待审批');
    if(process.env.VEHICLE_TRIP_UI_TEST==='true') {
      const {chromium}=await import(process.env.DISPATCH_PLAYWRIGHT_MODULE||'playwright');
      const {vehicleTripMessageBody}=await import('../server/integrations/dingtalk/vehicleTripNotifications.mjs');
      const browser=await chromium.launch({headless:true,executablePath:process.env.DISPATCH_CHROME_PATH});
      try {
        const openNotice=async(user,action,request,mobile)=>{
          const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile});
          const page=await context.newPage();page.setDefaultTimeout(12000);
          await page.addInitScript(token=>localStorage.setItem('repair-h5-auth-token',token),await tokenFor(user));
          const message=vehicleTripMessageBody({action,payload:{...request,actorName:user.name}},'mock-recipient',{DISPATCH_APP_URL:base,DINGTALK_AGENT_ID:'123'});
          await page.goto(message.msg.markdown.text.match(/\[查看出车申请\]\(([^)]+)\)/)[1]);
          return page;
        };
        const approvalPage=await openNotice(manager2,'create',rosterTrip,false);
        const drawer=approvalPage.getByRole('dialog',{name:'出车申请详情',exact:true});
        await drawer.getByRole('button',{name:'批准申请',exact:true}).click();
        await drawer.getByText('待出车',{exact:true}).waitFor();
        assert.equal((await svc.detail(employee,rosterTrip.id)).approvedBy,manager2.id);
        const approvedPage=await openNotice(employee,'approve',await svc.detail(employee,rosterTrip.id),true);
        const employeeDrawer=approvedPage.getByRole('dialog',{name:'出车申请详情',exact:true});
        await employeeDrawer.getByRole('heading',{name:'出车登记',exact:true}).waitFor();
        assert.equal(await employeeDrawer.getByRole('button',{name:'批准申请',exact:true}).count(),0);
        assert.equal(await approvedPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await fs.mkdir('output/playwright/trip-notifications',{recursive:true});
        await approvedPage.screenshot({path:'output/playwright/trip-notifications/approval-mobile.png',fullPage:true});
        await employeeDrawer.getByRole('button',{name:'关闭',exact:true}).click();
        assert.equal(new URL(approvedPage.url()).searchParams.has('vehicleTrip'),false);
        const denied=await openNotice(other,'approve',rosterTrip,true);
        await denied.getByText('申请不存在或无权访问',{exact:true}).first().waitFor();
        assert.equal(await denied.getByRole('heading',{name:'出车登记',exact:true}).count(),0);
      } finally {await browser.close();}
    }
    await pool.query('update users set active=false where id=$1', [employee.id]);
    assert.equal((await get('/api/vehicle-trip-requests')).status, 401);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    await admin.query(`drop database if exists "${name}" with (force)`); await admin.end();
    await fs.rm(uploads, { recursive: true, force: true });
  }
});
