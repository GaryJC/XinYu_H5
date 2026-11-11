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
  const connectionsClosed=[];
  try {
    await admin.query(`create database "${name}"`); url.pathname = `/${name}`;
    Object.assign(process.env, { DATABASE_URL: url.toString(), APP_ENV: 'development', DISPATCH_NOTIFICATION_MODE: 'mock', ENABLE_DEV_AUTH: 'true', JWT_SECRET: 'isolated-vehicle-trip-test-secret', FILE_STORAGE_PROVIDER: 'local', LOCAL_UPLOAD_ROOT: uploads });
    pool = (await import('../server/database/pool.mjs')).pool;
    pool.on('connect',client=>connectionsClosed.push(new Promise(resolve=>client.once('end',resolve))));
    for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql') && f !== '202608070005_remove_obsolete_runfeng_sync_role.sql' && f !== '202611100001_vehicle_trip_approval_departure.sql').sort()) await pool.query(await fs.readFile(`supabase/migrations/${file}`, 'utf8'));
    const { vehicleTripService: svc, prepareTripImage } = await import('../server/services/vehicleTripService.mjs');
    const { loginForDevelopment } = await import('../server/auth.mjs');
    const unassigned = await loginForDevelopment('unassigned'); assert.equal(unassigned.user.role, 'employee');
    const employee = (await loginForDevelopment('employee')).user;
    const manager = (await loginForDevelopment('manager')).user;
    const other = { ...employee, id: 'other' }, manager2 = { ...manager, id: 'manager2' }, stranger = { ...manager, id: 'stranger', shopId: 'other-shop' };
    const technician = { ...employee, id: 'unbound', role: 'technician' };
    for (const user of [other, manager2, stranger, technician]) await pool.query('insert into users(id,name,role,shop_id,roles) values($1,$2,$3,$4,array[$3])', [user.id, user.name, user.role, user.shopId]);
    await pool.query("insert into vehicle_trip_requests(id,shop_id,applicant_id,applicant_name,vehicle_id,vehicle_snapshot,reason,status,return_at) values('migration-return','shop-hq',$1,'员工','cv_60778','{}','迁移验证','待收车审核','2026-11-09T01:00:00Z')",[employee.id]);
    await pool.query(await fs.readFile('supabase/migrations/202611100001_vehicle_trip_approval_departure.sql','utf8'));
    const upgraded=(await pool.query("select * from vehicle_trip_requests where id='migration-return'")).rows[0];
    assert.equal(upgraded.status,'已还车');assert.equal(upgraded.return_at.toISOString(),'2026-11-09T01:00:00.000Z');assert.equal(upgraded.return_reviewed_by,null);assert.equal(upgraded.departure_evidence,'mileage');
    await pool.query("delete from vehicle_trip_requests where id='migration-return'");
    const fails = (promise, code) => assert.rejects(() => promise, e => e.status === code);
    const key = () => ({ requestId: randomUUID() });
    const imageBase64 = (await sharp({ create: { width: 80, height: 40, channels: 3, background: '#102030' } }).png().toBuffer()).toString('base64');
    const create = (user, input) => svc.create(user, { departurePhotos: [imageBase64], ...input });
    await pool.query("update company_vehicles set insurance_start='2020-01-01',insurance_end='2099-12-31'");
    const cars = await svc.vehicles(employee); assert.equal(cars.length, 8);
    assert.deepEqual(cars.map(v => v.plate).sort(), ['鲁B60778','鲁BDT7922','鲁BDS3250','鲁BDQ2235','鲁BD56565','鲁BB62767','鲁BD09326','鲁BA86281'].sort());
    await fails(svc.saveVehicle(employee, { plate: '鲁BTEST', brand: '测试', model: '测试' }), 403);
    const car = await svc.saveVehicle(manager, { plate: ' 鲁 btest ', brand: '测试', model: '测试',insuranceStart:'2020-01-01',insuranceEnd:'2099-12-31' }); assert.equal(car.plate, '鲁BTEST');
    await fails(svc.saveVehicle(manager, { plate: '鲁BTEST', brand: '其他', model: '其他' }), 409);
    await fails(svc.saveVehicle(stranger, car, car.id), 404);
    const input={...key(),vehicleId:car.id,reason:'外出办事',note:''};
    for(const departurePhotos of [undefined,[],Array(10).fill(imageBase64),['invalid'],[imageBase64,'invalid'],['a'.repeat(12*1024*1024+1)]]) await fails(create(employee,{...input,departurePhotos}),400);
    assert.equal((await svc.list(employee)).length,0);
    const [trip,retry]=await Promise.all([create(employee,input),create(employee,input)]);
    assert.equal(trip.id,retry.id);assert.equal(trip.status,'待审批');assert.equal(trip.departureAt,undefined);assert.equal(trip.departureEvidence,'mileage');
    await fails(create(employee,{...input,reason:'更改'}),409);
    await fails(create(employee,{...input,departurePhotos:[imageBase64,imageBase64]}),409);
    await svc.saveVehicle(manager,{...car,insuranceStart:'2020-01-01',insuranceEnd:'2020-02-01'},car.id);
    await fails(svc.act(manager,trip.id,'approve',key()),409);
    await fails(create(employee,{...key(),vehicleId:car.id,reason:'expired'}),409);
    await svc.saveVehicle(manager,car,car.id);
    const photo=(await svc.detail(manager,trip.id)).attachments[0];assert.equal(photo.confirmed,true);
    await svc.authorizeFile(manager,photo.fileId);
    await fails(svc.authorizeFile(other,photo.fileId),404);await fails(svc.authorizeFile(stranger,photo.fileId),404);
    await fails(svc.detail(other,trip.id),404);await fails(svc.detail(stranger,trip.id),404);
    await fails(svc.act(employee,trip.id,'depart',key()),409);
    await fails(svc.act(employee,trip.id,'approve',key()),403);
    await fails(svc.act(stranger,trip.id,'approve',key()),404);
    await fails(svc.act(employee,trip.id,'return',key()),409);
    await fails(prepareTripImage({imageBase64:'invalid'},'departure'),400);
    const upload=(user,id,stage,extra={})=>svc.upload(user,id,{...key(),stage,imageBase64,...extra});
    await fails(upload(manager,trip.id,'signature'),400);
    await svc.saveVehicle(manager,{...car,active:false},car.id);
    await fails(svc.act(manager,trip.id,'approve',key()),409);
    await svc.saveVehicle(manager,{...car,active:true,model:'新车型'},car.id);
    assert.equal((await svc.detail(employee,trip.id)).vehicle.model,'测试');
    const approveInput=key();
    const approvals=await Promise.allSettled([svc.act(manager,trip.id,'approve',approveInput),svc.act(manager2,trip.id,'approve',key())]);
    assert.equal(approvals.filter(r=>r.status==='fulfilled').length,1);assert.equal(approvals.find(r=>r.status==='rejected').reason.status,409);
    const approved=await svc.detail(employee,trip.id);assert.equal(approved.status,'用车中');assert.ok(approved.departureAt);assert.equal(approved.departureAt,approved.approvedAt);
    if(approvals[0].status==='fulfilled')assert.equal((await svc.act(manager,trip.id,'approve',approveInput)).departureAt,approved.departureAt);
    await fails(upload(employee,trip.id,'departure'),409);
    await fails(svc.act(employee,trip.id,'depart',key()),409);
    await fails(svc.act(employee,trip.id,'cancel',key()),409);
    await fails(svc.act(manager,trip.id,'return',key()),403);
    await fails(svc.act(employee,trip.id,'return',key()),400);
    await fails(svc.act(employee,trip.id,'return',{...key(),fileIds:[photo.fileId]}),400);
    const unusedPhoto=await upload(employee,trip.id,'return');
    const returnedPhoto=await upload(employee,trip.id,'return');
    await fails(svc.authorizeFile(manager,returnedPhoto.fileId),404);
    await svc.saveVehicle(manager,{...car,active:false},car.id);
    const returnInput={...key(),fileIds:[returnedPhoto.fileId]};
    const returned=await svc.act(employee,trip.id,'return',returnInput);
    assert.equal(returned.status,'已还车');assert.ok(returned.returnAt);assert.equal(returned.returnReviewedBy,null);
    assert.equal((await svc.act(employee,trip.id,'return',returnInput)).returnAt,returned.returnAt);
    await svc.authorizeFile(manager,returnedPhoto.fileId);
    assert.ok(!(await svc.detail(employee,trip.id)).attachments.some(a=>a.fileId===unusedPhoto.fileId));
    for(const action of ['approve-return','reject-return'])await fails(svc.act(manager,trip.id,action,{...key(),returnRound:1,reason:'停用审核'}),409);
    assert.deepEqual((await svc.detail(employee,trip.id)).history.map(h=>h.action),['create','approve','return']);
    await svc.saveVehicle(manager,{...car,active:true},car.id);
    const own=await create(manager,{...key(),vehicleId:car.id,reason:'管理员本人申请'});
    await fails(svc.act(manager,own.id,'approve',key()),403);
    await fails(svc.act(manager,own.id,'reject',{...key(),reason:'自审'}),403);
    // Existing approved records with missing evidence can still be completed without a new application.
    const another=await create(employee,{...key(),vehicleId:cars[0].id,reason:'旧申请补拍'});
    await pool.query("update vehicle_trip_requests set status='待出车',departure_evidence='mileage',approved_by=$2 where id=$1",[another.id,manager.id]);
    await pool.query('delete from vehicle_trip_attachments where trip_id=$1',[another.id]);
    await fails(svc.act(employee,another.id,'depart',key()),400);
    const legacyPhoto=await upload(employee,another.id,'departure');
    assert.equal((await svc.act(employee,another.id,'depart',{...key(),fileIds:[legacyPhoto.fileId]})).status,'用车中');
    assert.equal((await svc.detail(employee,another.id)).departureEvidence,'mileage');
    const rejected=await create(employee,{...key(),vehicleId:cars[1].id,reason:'待驳回'});
    await fails(svc.act(manager,rejected.id,'reject',key()),400);
    assert.equal((await svc.act(manager,rejected.id,'reject',{...key(),reason:'公里数不清晰'})).status,'已驳回');

    const missing=await create(employee,{...key(),vehicleId:cars[6].id,reason:'旧待审批补照片'});
    await pool.query('delete from vehicle_trip_attachments where trip_id=$1',[missing.id]);
    await fails(svc.act(manager,missing.id,'approve',key()),400);
    const supplement=await upload(employee,missing.id,'departure');assert.equal(supplement.confirmed,true);
    await svc.authorizeFile(manager,supplement.fileId);
    await fails(svc.act(employee,missing.id,'depart',key()),409);
    assert.equal((await svc.act(manager,missing.id,'approve',key())).status,'用车中');
    // Notification events are durable and share the operation's transaction/idempotency boundary.
    const notificationRepo=await import('../server/repositories/vehicleTripNotificationRepository.mjs');
    const {resolveTripRecipients,processTripNotification}=await import('../server/workers/vehicleTripNotifications.mjs');
    const {transaction}=await import('../server/database/pool.mjs');
    const queuedFor=async id=>(await pool.query('select * from vehicle_trip_notification_jobs where trip_id=$1 order by created_at',[id])).rows;
    assert.deepEqual((await queuedFor(trip.id)).map(j=>j.action),['create','approve']);
    assert.equal((await queuedFor(trip.id)).filter(j=>j.action==='approve').length,1,'concurrent approval queues one event');
    assert.equal((await queuedFor(trip.id)).filter(j=>j.action==='create').length,1,'identical concurrent create queues one event');
    assert.ok((await queuedFor(trip.id)).every(j=>!j.action.startsWith('upload:')));
    // Old return jobs stop before roster access, while recorded delivery outcomes survive migration.
    const oldReturnId=randomUUID();
    await pool.query("insert into vehicle_trip_notification_jobs(id,trip_id,actor_id,request_id,action,payload) values($1,$2,$3,$4,'return',$5)",[oldReturnId,trip.id,employee.id,returnInput.requestId,JSON.stringify(returned)]);
    await notificationRepo.queueTripRecipients({...((await queuedFor(trip.id)).find(j=>j.id===oldReturnId))},undefined,transaction);
    assert.equal((await pool.query('select status from vehicle_trip_notification_jobs where id=$1',[oldReturnId])).rows[0].status,'obsolete');
    const oldReturnNotices=[];
    for(const status of ['pending','accepted','unknown','sent','failed']) {
      const recipientId='return-history-'+status,id=randomUUID();
      await pool.query("insert into users(id,name,role,shop_id) values($1,$1,'manager','shop-hq')",[recipientId]);
      await pool.query("insert into vehicle_trip_notifications(id,job_id,recipient_id,status,error,task_id) values($1,$2,$3,$4,'preserve history','old-task')",[id,oldReturnId,recipientId,status]);
      oldReturnNotices.push((await pool.query('select * from vehicle_trip_notifications where id=$1',[id])).rows[0]);
    }
    await pool.query(await fs.readFile('supabase/migrations/202611110005_targeted_notifications.sql','utf8'));
    for(const old of oldReturnNotices) {
      const current=(await pool.query('select * from vehicle_trip_notifications where id=$1',[old.id])).rows[0];
      if(old.status==='pending')assert.equal(current.status,'suppressed');
      else assert.deepEqual(current,old);
    }
    const late=oldReturnNotices[0];
    await processTripNotification({database:pool,claim:async()=>({...late,previous_status:'pending'}),
      finish:async(_,result)=>assert.equal(result.status,'suppressed'),send:async()=>assert.fail('retired return must never send')});
    await pool.query('delete from vehicle_trip_notifications where job_id=$1',[oldReturnId]);
    await pool.query('delete from vehicle_trip_notification_jobs where id=$1',[oldReturnId]);
    await pool.query("delete from users where id like 'return-history-%'");

    const waiting=await create(employee,{...key(),vehicleId:cars[1].id,reason:'通知收车测试'});
    for(let i=0;i<100;i++)if(!await resolveTripRecipients({database:pool,runTransaction:transaction}))break;
    const deliveries=async id=>(await pool.query('select n.*,j.action,j.trip_id from vehicle_trip_notifications n join vehicle_trip_notification_jobs j on j.id=n.job_id where j.trip_id=$1 order by n.created_at',[id])).rows;
    assert.deepEqual((await deliveries(trip.id)).map(n=>[n.action,n.recipient_id]).sort(),[],'returned trips have no broadcast; obsolete approval events do not send');
    const waitingTargets=(await deliveries(waiting.id)).map(n=>n.recipient_id);
    assert.ok(waitingTargets.includes(manager.id));assert.ok(waitingTargets.includes(manager2.id));
    assert.ok(!waitingTargets.includes(employee.id));assert.ok(!waitingTargets.includes(stranger.id));
    assert.ok((await deliveries(own.id)).every(n=>n.recipient_id!==manager.id),'manager cannot receive own approval reminder');
    assert.deepEqual((await deliveries(rejected.id)).map(n=>[n.action,n.recipient_id]),[['reject',employee.id]]);
    assert.ok((await deliveries(another.id)).every(n=>n.action==='create'||n.action==='depart'));
    // Messages queued before someone else approves are revalidated immediately before sending.
    await svc.act(manager,waiting.id,'approve',key());
    const obsolete=(await deliveries(waiting.id))[0];let sent=0;
    await processTripNotification({database:pool,claim:async()=>({...obsolete,previous_status:'pending'}),finish:async(_,result)=>{assert.equal(result.status,'failed');assert.equal(result.retryable,false);},send:async()=>{sent++;}});
    assert.equal(sent,0);
    // Real leases, retry schedule and platform acceptance without automatic result polling.
    await pool.query("update users set dingtalk_user_id='test-delivery-'||id where id=any($1::text[])",[[manager.id,manager2.id]]);
    await pool.query("update vehicle_trip_notifications set locked_until=now()+interval '1 hour'");
    const deliveryTrip=await create(employee,{...key(),vehicleId:cars[7].id,reason:'发送结果测试'});
    while(await resolveTripRecipients({database:pool,runTransaction:transaction})){}
    await pool.query("update vehicle_trip_notifications set locked_until=now()+interval '1 hour'");
    const target=(await deliveries(deliveryTrip.id))[0];await pool.query('update vehicle_trip_notifications set locked_until=null where id=$1',[target.id]);
    const [leaseA,leaseB]=await Promise.all([notificationRepo.claimTripDelivery(pool),notificationRepo.claimTripDelivery(pool)]);
    const claimed=leaseA||leaseB;assert.ok(claimed);assert.ok(!leaseA||!leaseB,'only one worker claims the target');
    await notificationRepo.finishTripDelivery({...claimed,lease_id:'stale'},{status:'sent'},pool);
    assert.equal((await pool.query('select status from vehicle_trip_notifications where id=$1',[target.id])).rows[0].status,'unknown');
    await notificationRepo.finishTripDelivery(claimed,{status:'failed',retryable:true,error:'钉钉限流'},pool);
    let saved=(await pool.query('select * from vehicle_trip_notifications where id=$1',[target.id])).rows[0];
    assert.equal(saved.status,'pending');assert.ok(saved.next_attempt_at>new Date());
    await pool.query('update vehicle_trip_notifications set next_attempt_at=now() where id=$1',[target.id]);
    let sends=0,queries=0;
    const transport={database:pool,send:async(notification,recipient)=>{sends++;assert.equal(notification.action,'create');assert.equal(notification.payload.id,deliveryTrip.id);return {status:'accepted',taskId:'mock-trip-task'};},query:async()=>{queries++;return {status:'sent'};}};
    await processTripNotification(transport);
    await pool.query('update vehicle_trip_notifications set next_attempt_at=now() where id=$1',[target.id]);
    await processTripNotification(transport);
    saved=(await pool.query('select * from vehicle_trip_notifications where id=$1',[target.id])).rows[0];
    assert.equal(saved.status,'accepted');assert.equal(sends,1);assert.equal(queries,0);assert.ok(saved.delivery_user_id);assert.ok(saved.delivery_submitted_at);
    // Production roster failures do not fall back to whichever managers have logged in locally.
    const rosterTrip=await create(employee,{...key(),vehicleId:cars[2].id,reason:'通讯录故障测试'});
    await pool.query("update vehicle_trip_notification_jobs set locked_until=now()+interval '1 hour' where trip_id<>$1 and status='pending'",[rosterTrip.id]);
    const dingEnv={APP_ENV:'test',DISPATCH_NOTIFICATION_MODE:'dingtalk',DINGTALK_AGENT_ID:'123',DINGTALK_APP_KEY:'fake',DINGTALK_APP_SECRET:'fake',DISPATCH_APP_URL:'https://example.test'};
    await resolveTripRecipients({database:pool,runTransaction:transaction,env:dingEnv,sync:async()=>{throw new Error('通讯录不可用');}});
    let rosterJob=(await queuedFor(rosterTrip.id))[0];assert.equal(rosterJob.status,'pending');assert.match(rosterJob.error,/通讯录不可用/);assert.equal((await deliveries(rosterTrip.id)).length,0);
    await pool.query('update vehicle_trip_notification_jobs set next_attempt_at=now() where id=$1',[rosterJob.id]);
    await resolveTripRecipients({database:pool,runTransaction:transaction,env:dingEnv,sync:async()=>[manager2.id,stranger.id,employee.id]});
    assert.deepEqual((await deliveries(rosterTrip.id)).map(n=>n.recipient_id),[manager2.id]);
    // No other manager: retain a visible retryable resolution job, never notify the applicant themself.
    const soloTrip=await create(manager,{...key(),vehicleId:cars[3].id,reason:'没有其他审核人'});
    await resolveTripRecipients({database:pool,runTransaction:transaction,env:dingEnv,sync:async()=>[manager.id]});
    assert.equal((await queuedFor(soloTrip.id))[0].status,'pending');assert.equal((await deliveries(soloTrip.id)).length,0);
    // Failure to save the notification rolls back the application and operation together.
    await pool.query("create function trip_notification_test_failure() returns trigger language plpgsql as $$ begin raise exception 'notification insert failure'; end $$");
    await pool.query('create trigger trip_notification_test_failure before insert on vehicle_trip_notification_jobs for each row execute function trip_notification_test_failure()');
    const rollback=key(),countBefore=(await svc.list(employee)).length;
    const attachmentsBefore = (await pool.query('select count(*) from vehicle_trip_attachments')).rows[0].count;
    await assert.rejects(create(employee,{...rollback,vehicleId:cars[4].id,reason:'应回滚'}),/notification insert failure/);
    assert.equal((await svc.list(employee)).length,countBefore);
    assert.equal((await pool.query('select count(*) from vehicle_trip_attachments')).rows[0].count, attachmentsBefore);
    assert.equal((await pool.query('select 1 from vehicle_trip_operations where actor_id=$1 and request_id=$2',[employee.id,rollback.requestId])).rowCount,0);
    await pool.query('drop trigger trip_notification_test_failure on vehicle_trip_notification_jobs');

    // All employees may use trips and order entry; dispatch still requires its own permissions/binding.
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
    async function tokenFor(user) { const token = createTokenForUser(user.id); await createAuthSession({ token, userId: user.id, expiresAt: new Date(Date.now() + 300000) }); return token; }
    const token = await tokenFor(employee), techToken = await tokenFor(technician);
    const get = (route, bearer = token) => fetch(base + route, { headers: { Authorization: `Bearer ${bearer}` } });
    assert.equal((await get('/api/vehicle-trip-requests')).status, 200);
    assert.equal((await get('/api/company-vehicles', techToken)).status, 200);
    assert.equal((await get('/api/work-orders')).status, 200);
    assert.equal((await get('/api/users')).status, 200);
    assert.equal((await get('/api/work-orders', techToken)).status, 200);
    assert.equal((await get('/api/dispatch/tasks')).status, 403);
    assert.equal((await get('/api/dispatch/tasks', techToken)).status, 403);
    assert.equal((await get(`/api/files/${photo.fileId}/content`)).status, 200);
    assert.equal((await get(`/api/files/${photo.fileId}/content`, await tokenFor(other))).status, 404);
    assert.equal((await get(`/api/files/${photo.fileId}/content`, await tokenFor(stranger))).status, 404);
    assert.equal((await create(technician, { ...key(), vehicleId: cars[4].id, reason: '未绑定员工也可申请' })).status, '待审批');
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
        const applicantPage=await openNotice(employee,'create',rosterTrip,true);
        const firstDrawer=applicantPage.getByRole('dialog',{name:'出车申请详情',exact:true});
        await firstDrawer.getByText('待审批',{exact:true}).waitFor();
        assert.equal(await firstDrawer.getByRole('button',{name:'确认出车',exact:true}).count(),0);
        await firstDrawer.getByRole('button',{name:'关闭',exact:true}).click();
        const form=applicantPage.locator('form#vehicle-trip-create');
        await form.getByRole('combobox').fill(cars[5].plate);
        await form.getByRole('combobox').press('ArrowDown');await form.getByRole('combobox').press('Enter');
        const reason='送维修配件并到客户现场确认车辆情况，办理完毕后返回门店。'.repeat(3);
        await form.locator('#vehicle-trip-create_reason').fill(reason);
        await form.locator('button[type="submit"]').click();
        await applicantPage.getByText('请先拍摄公里数照片',{exact:true}).first().waitFor();
        const camera=form.getByLabel('拍摄申请用车公里数',{exact:true});
        assert.equal(await camera.getAttribute('capture'),'environment');
        assert.equal(await form.getByAltText('仪表盘总公里数拍摄示例').count(),1);
        const file={name:'mileage.png',mimeType:'image/png',buffer:Buffer.from(imageBase64,'base64')};
        await camera.setInputFiles(file);await form.getByAltText('公里数照片 1',{exact:true}).waitFor();
        await fs.mkdir('output/playwright/trip-approval-correction',{recursive:true});
        await form.getByText('点亮仪表盘，拍清总公里数和单位',{exact:true}).scrollIntoViewIfNeeded();
        await applicantPage.screenshot({path:'output/playwright/trip-approval-correction/mileage-camera-mobile.png',animations:'disabled'});
        await form.locator('button[type="submit"]').scrollIntoViewIfNeeded();
        await applicantPage.screenshot({path:'output/playwright/trip-approval-correction/application-mobile.png',animations:'disabled'});
        await form.locator('button[type="submit"]').click();
        await form.getByAltText('公里数照片 1',{exact:true}).waitFor({state:'detached'});
        const created=(await svc.list(employee)).find(t=>t.reason===reason);assert.ok(created);
        assert.equal(created.status,'待审批');assert.equal(created.departureAt,undefined);
        const reviewer=await openNotice(manager2,'create',created,true);
        const reviewDrawer=reviewer.getByRole('dialog',{name:'出车申请详情',exact:true});
        await reviewer.setViewportSize({width:360,height:800});
        await reviewDrawer.getByRole('heading',{name:'申请公里数照片',exact:true}).scrollIntoViewIfNeeded();
        await reviewDrawer.locator('.trip-photos').first().scrollIntoViewIfNeeded();
        await reviewer.waitForFunction(()=>Array.from(document.querySelectorAll('img[alt="申请公里数照片"]')).some(img=>img.complete&&img.naturalWidth>0&&img.getAttribute('src')?.startsWith('data:image/'))).catch(async error=>{
          console.log(await reviewDrawer.locator('.authenticated-image').evaluateAll(nodes => nodes.map(node => node.outerHTML.slice(0,1600))));
          throw error;
        });
        await reviewDrawer.getByRole('button',{name:'批准并出车',exact:true}).scrollIntoViewIfNeeded();
        assert.equal(await reviewer.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await reviewer.screenshot({path:'output/playwright/trip-approval-correction/approval-mobile.png',animations:'disabled'});
        await reviewDrawer.getByRole('button',{name:'批准并出车',exact:true}).click();
        await reviewDrawer.getByText('用车中',{exact:true}).waitFor();
        const approved=await svc.detail(employee,created.id);assert.ok(approved.departureAt);assert.equal(approved.approvedBy,manager2.id);
        const driver=await openNotice(employee,'approve',approved,true);
        const drawer=driver.getByRole('dialog',{name:'出车申请详情',exact:true});
        await drawer.getByRole('heading',{name:'还车登记',exact:true}).waitFor();
        assert.equal(await drawer.getByRole('button',{name:'确认出车',exact:true}).count(),0);
        const returnCamera=drawer.getByLabel('上传收车公里数照片',{exact:true});assert.equal(await returnCamera.getAttribute('capture'),'environment');
        await returnCamera.setInputFiles(file);
        await drawer.getByRole('button',{name:'确认还车',exact:true}).click();
        await drawer.getByText('已还车',{exact:true}).waitFor();
        const completed=await svc.detail(employee,created.id);assert.ok(completed.returnAt);assert.equal(completed.returnReviewedBy,null);
        assert.equal(await drawer.getByRole('button',{name:'审核通过',exact:true}).count(),0);
        await driver.screenshot({path:'output/playwright/trip-approval-correction/returned-mobile.png',animations:'disabled'});
        await reviewer.goto(base);await reviewer.setViewportSize({width:1440,height:1000});
        await reviewer.getByRole('button',{name:'查看待审批事项',exact:true}).click();
        await reviewer.getByRole('button',{name:'查看出车申请待审批事项',exact:true}).click();
        await reviewer.getByRole('combobox',{name:'筛选出车申请',exact:true}).waitFor();
        assert.equal(await reviewer.getByRole('button',{name:/查看申请：.*，用车中$/}).count(),0);
        await reviewer.screenshot({path:'output/playwright/trip-approval-correction/pending-desktop.png',animations:'disabled'});
        await reviewer.setViewportSize({width:390,height:844});
        await reviewer.getByRole('button',{name:'打开菜单',exact:true}).click();
        await reviewer.getByRole('button',{name:'车辆管理',exact:true}).click();
        await reviewer.getByRole('heading',{name:'公司车辆管理',exact:true}).waitFor();
        const UIX=await import('xlsx'),uiBook=UIX.utils.book_new();
        UIX.utils.book_append_sheet(uiBook,UIX.utils.aoa_to_sheet([
          ['原车号','新车牌号','车型','登记及年审时间','保险终保时间','车辆状况','车辆使用部门','产权归属','投保付款单位','承保公司'],
          ['旧牌照',car.plate,'测试车辆','2020--1--1','2020.1.1-2099.12.31','车况良好','维修及客户服务部门长文字换行测试','公司','公司','保险公司承保服务中心长文字换行测试']
        ]),'Sheet1');
        await reviewer.locator('input[type="file"]').setInputFiles({name:'保险.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:UIX.write(uiBook,{type:'buffer',bookType:'xlsx'})});
        const preview=reviewer.getByRole('dialog',{name:'确认导入车辆及保险',exact:true});await preview.waitFor();await preview.locator('.ant-card').first().scrollIntoViewIfNeeded();
        await reviewer.screenshot({path:'output/playwright/trip-approval-correction/insurance-import-mobile.png',animations:'disabled'});
        await preview.getByRole('button',{name:'确认更新',exact:true}).click();await preview.waitFor({state:'hidden'});
        await reviewer.getByRole('searchbox',{name:'搜索公司车辆',exact:true}).fill(car.plate);
        await reviewer.locator('.company-vehicle-grid').getByText('保险公司承保服务中心长文字换行测试',{exact:false}).waitFor();
        await reviewer.screenshot({path:'output/playwright/trip-approval-correction/insurance-vehicle-mobile.png',animations:'disabled'});
        const denied=await openNotice(other,'create',created,true);
        await denied.getByText('申请不存在或无权访问',{exact:true}).first().waitFor();
      } finally {await browser.close();}
    }
    const XLSX=await import('xlsx');
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([
      ['公司车辆保险承保明细表'],['原车号','新车牌号','车型','登记及年审时间','保险终保时间','车辆状况','车辆使用部门','产权归属','投保付款单位','承保公司'],
      ['旧车牌',car.plate,'测试车型','2020--1--1','2020.1.1-2099.12.31','状态','部门','产权','付款','保险公司']
    ]),'Sheet1');
    const importInput={fileBase64:XLSX.write(book,{type:'base64',bookType:'xlsx'})};
    await fails(svc.importVehicles(employee,importInput),403);
    assert.equal((await svc.importVehicles(manager,importInput)).rows.length,1);
    await svc.saveVehicle(manager,{...car,active:false},car.id);
    await svc.importVehicles(manager,{...importInput,preview:false});
    const imported=(await svc.vehicles(manager,true)).find(v=>v.id===car.id);
    assert.equal(imported.active,false);assert.equal(imported.insuranceEnd,'2099-12-31');assert.equal(imported.insuranceDetails.owner,'产权');
    await svc.importVehicles(manager,{...importInput,preview:false});
    assert.equal((await svc.vehicles(manager,true)).filter(v=>v.plate===car.plate).length,1);
    const {queueInsuranceReminders,deliverInsuranceReminder}=await import('../server/workers/vehicleInsuranceNotifications.mjs');
    const mockEnv={APP_ENV:'test',DISPATCH_NOTIFICATION_MODE:'mock'};
    await pool.query("update company_vehicles set active=true,insurance_start='2020-01-01',insurance_end=(now() at time zone 'Asia/Shanghai')::date+7 where id=$1",[car.id]);
    await queueInsuranceReminders({database:pool,env:mockEnv});
    const queued=await pool.query('select * from vehicle_insurance_notifications where vehicle_id=$1',[car.id]);assert.ok(queued.rows.length>0);
    await queueInsuranceReminders({database:pool,env:mockEnv});
    assert.equal((await pool.query('select count(*)::int as n from vehicle_insurance_notifications where vehicle_id=$1',[car.id])).rows[0].n,queued.rows.length);
    let insuranceSends=0;
    await deliverInsuranceReminder({database:{query:(sql,args)=>sql.startsWith('select v.plate')?Promise.reject(new Error('temporary database failure')):pool.query(sql,args)},env:mockEnv,send:async()=>{insuranceSends++;return {status:'sent'};}});
    assert.equal(insuranceSends,0);
    assert.equal((await pool.query("select count(*)::int as n from vehicle_insurance_notifications where vehicle_id=$1 and status='pending'",[car.id])).rows[0].n,queued.rows.length);
    await pool.query("update vehicle_insurance_notifications set next_attempt_at=now() where status='pending'");
    await deliverInsuranceReminder({database:pool,env:mockEnv,send:async()=>{insuranceSends++;return {status:'accepted',taskId:'mock-insurance'};}});assert.equal(insuranceSends,1);
    await pool.query("update company_vehicles set insurance_end='2099-12-31' where id=$1",[car.id]);
    while(await deliverInsuranceReminder({database:pool,env:mockEnv,send:async()=>{insuranceSends++;return {status:'sent'};}})){}
    assert.equal(insuranceSends,1,'renewed policy must not notify');
    await pool.query('update users set active=false where id=$1', [employee.id]);
    assert.equal((await get('/api/vehicle-trip-requests')).status, 401);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    await Promise.all(connectionsClosed);
    await admin.query(`drop database if exists "${name}" with (force)`); await admin.end();
    await fs.rm(uploads, { recursive: true, force: true });
  }
});
