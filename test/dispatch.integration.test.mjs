import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import path from 'node:path';
import pg from 'pg';
const adminUrl=process.env.DISPATCH_TEST_ADMIN_URL;
// Opt-in only: never infer a database from .env or touch application data.
test('dispatch PostgreSQL migrations, concurrency, HTTP permissions and notification leases', {skip:!adminUrl,timeout:180000}, async t=>{
  const parsed=new URL(adminUrl);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(parsed.hostname),'Only a local test server is allowed');
  const name=`codex_dispatch_test_${process.pid}_${Date.now()}`;
  const admin=new pg.Client({connectionString:adminUrl,connectionTimeoutMillis:5000});
  let pool,server;
  const inFlight=new Set();
  const connectionsClosed=[];
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
    parsed.pathname=`/${name}`;
    process.env.DATABASE_URL=parsed.toString();process.env.APP_ENV='test';process.env.JWT_SECRET='isolated-dispatch-test-secret-at-least-32-characters';process.env.DISPATCH_NOTIFICATION_MODE='mock';
    const database=await import('../server/database/pool.mjs');pool=database.pool;
    pool.on('connect',client=>connectionsClosed.push(new Promise(resolve=>client.once('end',resolve))));
    const files=(await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();
    // Cluster-wide obsolete-role cleanup is unrelated to this feature and must not run against the host cluster.
    for(const file of files.filter(f=>f!=='202608070005_remove_obsolete_runfeng_sync_role.sql'&&f<'202609110001')) await pool.query(await fs.readFile(`supabase/migrations/${file}`,'utf8'));
    const people=[
      {id:'manager',name:'管理员',role:'manager',active:true,shopId:'shop-hq'},
      {id:'dispatcher',name:'派单员',role:'dispatcher',active:true,shopId:'shop-hq'},
      {id:'tech',name:'同名技师',role:'technician',active:true,shopId:'shop-hq'},
      {id:'tech2',name:'同名技师',role:'technician',active:true,shopId:'shop-hq'},
      {id:'unique',name:'唯一技师',role:'technician',active:true,shopId:'shop-hq'},
      {id:'inspector',name:'检验员',role:'inspector',active:true,shopId:'shop-hq'},
      {id:'advisor',name:'顾问',role:'advisor',active:true,shopId:'shop-hq'},
      {id:'outside',name:'其他店管理员',role:'manager',active:true,shopId:'other'}
    ];
    for(const p of people) await pool.query('insert into users(id,name,role,shop_id,active,dingtalk_user_id) values($1,$2,$3,$4,$5,$6)',[p.id,p.name,p.role,p.shopId,p.active,`ding-${p.id}`]);
    const [manager,dispatcher,tech,tech2,unique,inspector,advisor,outside]=people;
    async function seed(id,status='已委托',technician='待派工'){
      await pool.query(`insert into work_orders(id,status,advisor,technician,inspector,shop_id,old_parts_handling,vehicle_plate,arrival_date) values($1,$2,'顾问',$3,'待检验','shop-hq','客户带走','鲁B12345','2026-09-11')`,[id,status,technician]);
      for(const item of [1,2]) await pool.query(`insert into repair_items(order_id,client_item_id,item_no,name,status) values($1,$2::bigint,$2::integer,$3,'待派工')`,[id,item,`项目${item}`]);
    }
    await seed('legacy-ambiguous','维修中','同名技师');await seed('legacy-unique','待结算','唯一技师');
    await pool.query(await fs.readFile('supabase/migrations/202609110001_dispatch_management.sql','utf8'));
    await pool.query(await fs.readFile('supabase/migrations/202609110002_advisor_dispatch_plans.sql','utf8'));
    for(const file of files.filter(f=>f>'202609110002_advisor_dispatch_plans.sql')) await pool.query(await fs.readFile(`supabase/migrations/${file}`,'utf8'));
    dispatcher.role='advisor';
    const service=await import('../server/services/dispatchService.mjs');
    async function progressPhoto(id,round=0,kind='repair_progress_photo'){const file=randomUUID();await pool.query("insert into files(id,order_id,kind,storage_provider,bucket,object_key,mime_type,size_bytes,uploaded_by,repair_round) values($1,$2,$3,'local','','fixture','image/png',8,$4,$5)",[file,id,kind,tech.id,round]);return file;}
    const repo=await import('../server/repositories/dispatchRepository.mjs');
    const notifications=await import('../server/repositories/dispatchNotificationRepository.mjs');
    const worker=await import('../server/workers/dispatchNotifications.mjs');
    const {transitionWorkOrder,syncWorkOrderToPlatform}=await import('../server/db.mjs');
    const {assertFileReadAccess}=await import('../server/repositories/fileRepository.mjs');
    let task;
    const body=(action,extra={})=>({action,expectedVersion:task?.version||0,requestId:randomUUID(),...(action==='inspect'&&!extra.rejectedItemIds?.length?{workHours:2.5}:{}),...(action==='accept'?{partsRequirement:{mode:'none',items:[],photoIds:[]}}:{}),...extra});
    const action=async(user,name,extra={})=>{const result=await service.executeDispatchAction(user,'new',body(name,extra));task=result.task;return result;};
    const dueAt=new Date(Date.now()+86400000).toISOString();
    await t.test('migration preserves ambiguous identities and never invents historical completion times',async()=>{
      const ambiguous=(await service.dispatchDetail(manager,'legacy-ambiguous')).task;
      assert.equal(ambiguous.technicianId,undefined);assert.equal(ambiguous.needsReview,true);
      const legacy=(await service.dispatchDetail(manager,'legacy-unique')).task;
      assert.equal(legacy.technicianId,'unique');assert.equal(legacy.completedAt,undefined);
      assert.equal((await service.technicianSummaries(manager)).find(p=>p.id==='unique').completed,0);
    });
    await t.test('draft preselection activates only at signature, retains actor and is atomic with Runfeng submission',async()=>{
      const db=await import('../server/db.mjs');
      const plan={technicianId:tech.id,dueAt,urgent:true,note:'开单预选'};
      const draft={shop:{id:'shop-hq'},advisor:advisor.name,dispatchPlan:plan,repairItems:[{id:1,name:'保养',status:'待派工'}]};
      let order=await db.createWorkOrder(draft,advisor.name,advisor);
      assert.equal(order.dispatchPlan.technicianId,tech.id);
      assert.equal((await pool.query('select 1 from dispatch_tasks where order_id=$1',[order.id])).rowCount,0);
      assert.equal((await pool.query('select 1 from dispatch_notifications where order_id=$1',[order.id])).rowCount,0);
      order=await db.updateWorkOrder({...order,dispatchPlan:null},advisor.name,'清除预选',advisor);
      assert.equal(order.dispatchPlan,undefined);
      await assert.rejects(()=>db.updateWorkOrder({...order,dispatchPlan:{...plan,technicianId:outside.id}},advisor.name,'跨店',advisor),e=>e.status===400);
      order=await db.updateWorkOrder({...order,dispatchPlan:plan},advisor.name,'预选',advisor);
      async function prepareSignature(order) {
        await pool.query("update work_orders set status='待客户签字' where id=$1",[order.id]);
        const token=randomUUID(),file=randomUUID();
        await pool.query('insert into signature_tokens(token,order_id) values($1,$2)',[token,order.id]);
        await pool.query("insert into files(id,order_id,kind,storage_provider,bucket,object_key,original_name,mime_type,size_bytes,uploaded_by) values($1,$2,'signature_image','local','','test','signature.png','image/png',1,$3)",[file,order.id,advisor.id]);
        return {token,file};
      }
      const signature=await prepareSignature(order);
      const signed=await db.signWorkOrderByToken(signature.token,{name:'车主',signedAt:new Date().toISOString()},signature.file);
      assert.equal(signed.status,'待派工');
      assert.equal(signed.technician,tech.name);
      const assigned=(await service.dispatchDetail(advisor,order.id)).task;
      assert.equal(assigned.stage,'待接单');assert.equal(assigned.assignedBy,advisor.id);assert.equal(assigned.urgent,true);
      assert.equal((await pool.query('select 1 from dispatch_notifications where order_id=$1',[order.id])).rowCount,1);
      assert.equal((await pool.query('select 1 from legacy_sync_outbox where order_id=$1',[order.id])).rowCount,1);
      await assert.rejects(()=>db.signWorkOrderByToken(signature.token,{},signature.file),e=>e.status===409);
      assert.equal((await pool.query('select 1 from dispatch_notifications where order_id=$1',[order.id])).rowCount,1);
      const fallback=await db.createWorkOrder(draft,advisor.name,advisor);
      const secondSignature=await prepareSignature(fallback);
      await pool.query("update users set active=false where id=$1",[tech.id]);
      const saved=await db.signWorkOrderByToken(secondSignature.token,{name:'车主'},secondSignature.file);
      assert.equal(saved.status,'已委托');assert.ok(saved.dispatchPlan.activationError);
      assert.equal((await pool.query('select 1 from dispatch_notifications where order_id=$1',[fallback.id])).rowCount,0);
      await pool.query("update users set active=true where id=$1",[tech.id]);
      await service.executeDispatchAction(advisor,fallback.id,{action:'assign',expectedVersion:0,requestId:randomUUID(),technicianId:tech.id,dueAt});
      assert.equal((await service.dispatchDetail(advisor,fallback.id)).task.stage,'待接单');
      assert.equal((await pool.query('select activation_error from work_order_dispatch_plans where order_id=$1',[fallback.id])).rows[0].activation_error,'');
    });
    await t.test('warehouse applications persist confirmation, concurrency, notifications and revision history',async()=>{
      const warehouse={id:'warehouse',name:'仓管',role:'warehouse',shopId:'shop-hq',active:true};
      await pool.query("insert into users(id,name,role,shop_id,active) values('warehouse','仓管','warehouse','shop-hq',true)");
      await seed('warehouse-order');
      const run=(actor,action,version,extra={})=>service.executeDispatchAction(actor,'warehouse-order',{action,expectedVersion:version,requestId:randomUUID(),...extra});
      await run(manager,'assign',0,{technicianId:tech.id,dueAt});
      const requirement={mode:'list',items:[{name:'机油',quantity:4,unit:'升'}]};
      const accepted=await run(tech,'accept',1,{partsRequirement:requirement});
      assert.ok((await service.queryDispatchTasks(warehouse)).some(t=>t.orderId==='warehouse-order'));
      assert.equal((await pool.query("select 1 from dispatch_notifications where order_id='warehouse-order' and kind='配件申请' and recipient_id='warehouse'")).rowCount,1);
      const command={action:'confirm-parts',expectedVersion:accepted.task.version,requestId:randomUUID()};
      const results=await Promise.allSettled([service.executeDispatchAction(warehouse,'warehouse-order',command),service.executeDispatchAction(warehouse,'warehouse-order',command)]);
      assert.ok(results.every(r=>r.status==='fulfilled'));
      assert.equal((await pool.query("select 1 from dispatch_events where order_id='warehouse-order' and action='confirm-parts'")).rowCount,1);
      const confirmed=await service.dispatchDetail(warehouse,'warehouse-order');
      assert.equal(confirmed.task.partsRequirement.preparedBy,'warehouse');
      await assert.rejects(()=>run(warehouse,'confirm-parts',accepted.task.version),e=>e.status===409);
      await assert.rejects(()=>service.dispatchDetail({...warehouse,shopId:'other'},'warehouse-order'),e=>e.status===403);
      const updated=await run(tech,'record-parts',confirmed.task.version,{partsRequirement:{...requirement,items:[{name:'滤芯',quantity:1,unit:'个'}]}});
      assert.equal(updated.task.partsRequirement.preparedAt,undefined);
      assert.ok(updated.events.some(e=>e.action==='confirm-parts' && e.detail.partsRequirement.preparedBy==='warehouse'));
      // The modified batch invalidates the old preparation and its pending pickup notice.
      await assert.rejects(()=>run(warehouse,'issue-parts',updated.task.version),e=>e.status===409);
      const ready=await run(warehouse,'confirm-parts',updated.task.version);
      const issue={action:'issue-parts',expectedVersion:ready.task.version,requestId:randomUUID()};
      const issued=await Promise.all([service.executeDispatchAction(warehouse,'warehouse-order',issue),service.executeDispatchAction(warehouse,'warehouse-order',issue)]);
      assert.equal(issued[0].task.stage,'维修中');assert.equal(issued[0].task.partsRequirement.issuedBy,'warehouse');
      assert.ok(issued[0].task.items.every(i=>i.startedBy===tech.id));
      assert.equal((await pool.query("select 1 from dispatch_events where order_id='warehouse-order' and action='issue-parts'")).rowCount,1);
      assert.equal((await pool.query("select 1 from dispatch_notifications where order_id='warehouse-order' and kind='配件已出库'")).rowCount,1);
      const added=await run(tech,'record-parts',issued[0].task.version,{partsRequirement:requirement});
      assert.equal(added.task.stage,'维修中');assert.equal(added.task.partsRequirement.batch,2);assert.equal(added.task.partsRequirement.issuedAt,undefined);
      assert.ok(added.events.some(e=>e.action==='issue-parts'&&e.detail.partsRequirement.items[0].name==='滤芯'));
      assert.equal((await pool.query("select 1 from outbound_orders where order_id='warehouse-order'")).rowCount,0);
    });
    await t.test('warehouse edits persist audited changes and reset preparation atomically',async()=>{
      const warehouse={id:'warehouse',name:'仓管',role:'warehouse',shopId:'shop-hq',active:true};
      await seed('warehouse-edit');
      const run=(user,action,version,extra={})=>service.executeDispatchAction(user,'warehouse-edit',{action,expectedVersion:version,requestId:randomUUID(),...extra});
      await run(manager,'assign',0,{technicianId:tech.id,dueAt});
      const accepted=await run(tech,'accept',1,{partsRequirement:{mode:'list',items:[{name:'机油',quantity:4,unit:'升'}]}});
      const ready=await run(warehouse,'confirm-parts',accepted.task.version);
      const command={action:'edit-parts',expectedVersion:ready.task.version,requestId:randomUUID(),partsRequirement:{mode:'list',items:[{name:'机油 SN5W30',quantity:4,unit:'升'},{name:'机油滤清器',quantity:1,unit:'只'}]}};
      const [updated]=await Promise.all([service.executeDispatchAction(warehouse,'warehouse-edit',command),service.executeDispatchAction(warehouse,'warehouse-edit',command)]);
      await service.executeDispatchAction(warehouse,'warehouse-edit',{...command,partsRequirement:{items:command.partsRequirement.items.map(i=>({unit:i.unit,quantity:i.quantity,name:i.name})),mode:'list'}});
      await assert.rejects(()=>service.executeDispatchAction(warehouse,'warehouse-edit',{...command,partsRequirement:{...command.partsRequirement,items:[{name:'different',quantity:1,unit:'个'}]}}),e=>e.status===409);
      assert.equal(updated.task.partsRequirement.items.length,2);assert.equal(updated.task.partsRequirement.preparedAt,undefined);assert.equal(updated.task.stage,'待开工');
      assert.equal((await pool.query("select 1 from dispatch_events where order_id='warehouse-edit' and action='edit-parts'")).rowCount,1);
      assert.equal((await pool.query("select 1 from dispatch_notifications where order_id='warehouse-edit' and kind='配件需求已调整' and recipient_id='tech'")).rowCount,1);
      assert.ok(updated.events.some(e=>e.action==='confirm-parts'&&e.detail.partsRequirement.preparedAt));
      await assert.rejects(()=>run(warehouse,'issue-parts',updated.task.version),e=>e.status===409);
      await assert.rejects(()=>run(warehouse,'edit-parts',ready.task.version,{partsRequirement:{mode:'none'}}),e=>e.status===409);
      const none=await run(warehouse,'edit-parts',updated.task.version,{partsRequirement:{mode:'none'}});
      assert.equal(none.task.stage,'维修中');assert.ok(none.task.items.every(i=>i.startedBy===tech.id));assert.ok(!none.task.participantIds.includes('warehouse'));
    });
    await seed('new');
    await t.test('only one of two concurrent initial assignments commits; retry is idempotent',async()=>{
      const command=body('assign',{technicianId:tech.id,dueAt});
      const results=await Promise.allSettled([service.executeDispatchAction(dispatcher,'new',command),service.executeDispatchAction(dispatcher,'new',{...command,requestId:randomUUID(),technicianId:tech2.id})]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
      task=(await service.dispatchDetail(manager,'new')).task;
      // The winning actor can retry the identical stored request without additional events/messages.
      const stored=(await pool.query("select request_body from dispatch_events where order_id='new' limit 1")).rows[0].request_body;
      await service.executeDispatchAction(dispatcher,'new',stored);
      assert.equal(Number((await pool.query("select count(*) from dispatch_events where order_id='new'")).rows[0].count),1);
      assert.equal(Number((await pool.query("select count(*) from dispatch_notifications where order_id='new'")).rows[0].count),1);
      await assert.rejects(()=>service.executeDispatchAction(dispatcher,'new',{...stored,note:'changed'}),e=>e.status===409);
      if(task.technicianId!==tech.id) await action(dispatcher,'reassign',{technicianId:tech.id,dueAt,reason:'归一测试'});
    });
    await t.test('start is blocked until acceptance; pause and reassignment preserve item history',async()=>{
      await assert.rejects(()=>action(tech,'start',{itemId:1}),e=>e.status===409);
      await action(tech,'accept');
      const start=task.items[0].startAt;
      await action(tech,'pause',{pauseReason:'待配件'});assert.equal(task.stage,'暂停');
      await action(dispatcher,'reassign',{technicianId:tech2.id,dueAt,reason:'交接维修项目'});
      await assert.rejects(()=>service.dispatchDetail(tech,'new'),e=>e.status===403);
      await action(tech2,'accept');assert.equal(task.items[0].startAt,start);assert.equal(task.items[0].startedBy,'tech');
      await action(tech2,'finish',{itemId:1});await action(tech2,'finish',{itemId:2});
      assert.equal(task.orderStatus,'维修中');
    });
    await t.test('inspection partial rejection, completion totals and settlement remain distinct',async()=>{
      await assert.rejects(()=>action(tech2,'submit',{inspectorId:'inspector'}),/本轮维修照片/);
      await progressPhoto('new');
      await action(tech2,'submit',{inspectorId:'inspector'});
      assert.equal((await service.technicianSummaries(manager)).find(p=>p.id==='tech2').inspection,1);
      await action(inspector,'inspect',{rejectedItemIds:[1],reason:'制动重做'});
      assert.equal(task.items[1].status,'已完工');
      await action(tech2,'start',{itemId:1});await action(tech2,'finish',{itemId:1});await action(tech2,'submit',{inspectorId:'inspector'});
      await action(manager,'inspect',{rejectedItemIds:[]});assert.equal(task.orderStatus,'待结算');
      assert.equal((await service.technicianSummaries(manager)).find(p=>p.id==='tech2').completed,1);
      assert.equal(task.workHours,2.5);assert.equal(task.workHoursRecordedBy,manager.id);
      await assert.rejects(()=>action(tech2,'record-hours',{workHours:2}),e=>e.status===403);
      await assert.rejects(()=>action(dispatcher,'record-hours',{workHours:2.5}),e=>e.status===403);
      await transitionWorkOrder('new','完成',manager.name,'结算',{settlementAmount:0});
      assert.equal((await service.technicianSummaries(manager)).find(p=>p.id==='tech2').completed,1);
      assert.equal((await service.queryDispatchTasks(manager,{technicianId:'tech2',metric:'completed'})).length,1);
      assert.equal((await service.queryDispatchTasks(manager,{technicianId:'tech2',metric:'current'})).length,0);
    });
    await t.test('notification claims do not overlap and stale workers cannot acknowledge a new lease',async()=>{
      const [one,two]=await Promise.all([notifications.claimNotification(),notifications.claimNotification()]);
      assert.ok(one&&two);assert.notEqual(one.id,two.id);
      assert.equal(one.status,'unknown');
      await notifications.finishNotification({...one,lease_id:randomUUID()},{status:'sent'});
      assert.equal((await pool.query('select status from dispatch_notifications where id=$1',[one.id])).rows[0].status,'unknown');
      await notifications.finishNotification(one,{status:'accepted',taskId:'mock-1'});
      await notifications.finishNotification(two,{status:'failed',error:'test',retryable:false});
      await pool.query("update dispatch_notifications set next_attempt_at=now() where id=$1",[one.id]);
      let claimed;
      // Other due notifications may precede this one; drain safely using mock only.
      for(let i=0;i<30;i++){const row=await notifications.claimNotification();if(!row)break;await worker.processNotification({claim:async()=>row});if(row.id===one.id){claimed=row;break;}}
      assert.equal(claimed.previous_status,'accepted');
      assert.equal((await pool.query('select status from dispatch_notifications where id=$1',[one.id])).rows[0].status,'sent');
      await pool.query("update dispatch_notifications set locked_until=now()-interval '1 second' where status='unknown' and task_id is null");
      // A crashed send without platform ID is intentionally not eligible for automatic resending.
      const rows=(await pool.query("select id from dispatch_notifications where status='unknown' and task_id is null")).rows;
      for(let i=0;i<10;i++){const row=await notifications.claimNotification();if(!row)break;assert.ok(!rows.some(r=>r.id===row.id));await notifications.finishNotification(row,{status:'sent'});}
    });
    await t.test('cross-store access and attachment ownership are enforced after reassignment',async()=>{
      await assert.rejects(()=>service.dispatchDetail(outside,'new'),e=>e.status===403);
      assert.equal((await service.queryDispatchTasks(outside)).length,0);
      await pool.query("insert into files(id,order_id,kind,storage_provider,bucket,object_key,original_name,mime_type,size_bytes,uploaded_by) values('attachment','new','repair_order_photo','local','','test','test.png','image/png',1,'advisor')");
      await assertFileReadAccess('attachment',tech2);await assertFileReadAccess('attachment',dispatcher);
      await assert.rejects(()=>assertFileReadAccess('attachment',tech),e=>e.status===403);
      await assert.rejects(()=>assertFileReadAccess('attachment',outside),e=>e.status===403);
    });
    await t.test('old HTTP transitions cannot bypass inspection and role/list routes reject outsiders',async()=>{
      const {serveStatic}=await import('../server/http/staticFiles.mjs');
      const {handleApiRequest}=await import('../server/routes/apiRouter.mjs');
      const {createTokenForUser}=await import('../server/auth.mjs');
      const {createAuthSession}=await import('../server/repositories/userRepository.mjs');
      server=createServer((req,res)=>{const work=(async()=>{try{const handled=await handleApiRequest(req,res,new URL(req.url,'http://localhost'));if(!handled) await serveStatic(res,new URL(req.url,'http://localhost').pathname,path.resolve('dist'));}catch(e){res.statusCode=e.status||500;res.setHeader('content-type','application/json');res.end(JSON.stringify({error:e.message}));}})();inFlight.add(work);void work.finally(()=>inFlight.delete(work));});
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
      const token=createTokenForUser(manager.id);await createAuthSession({token,userId:manager.id,expiresAt:new Date(Date.now()+3600000)});
      const call=(path,body)=>fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
      assert.equal((await fetch(base+'/api/dispatch/tasks')).status,401);
      assert.equal((await call('/api/work-orders/new/transition',{status:'待结算'})).status,409);
      assert.equal((await call('/api/work-orders/new/repair-items/1/action',{action:'assign'})).status,409);
      assert.equal((await call('/api/dispatch/tasks/absent')).status,404);
      assert.equal((await call('/api/dispatch/tasks/new')).status,200);
      for (const [path, method] of [
        ['/api/admin/dingtalk-mappings', 'GET'],
        ['/api/admin/dingtalk-role-mappings', 'PUT'],
        ['/api/admin/dingtalk-department-mappings', 'PUT']
      ]) {
        assert.equal((await fetch(base + path, {method, headers: {Authorization: `Bearer ${token}`}})).status, 410);
      }
      const accessResponse=await call('/api/admin/access-users');
      assert.equal(accessResponse.status,200);
      const accessUsers=await accessResponse.json();
      assert.ok(accessUsers.some(user=>user.id==='tech'));
      assert.ok(accessUsers.every(user=>user.shopId===manager.shopId && !('phone' in user)));
      assert.equal((await fetch(base+'/api/admin/access-users')).status,401);
      const advisorToken=createTokenForUser(advisor.id);await createAuthSession({token:advisorToken,userId:advisor.id,expiresAt:new Date(Date.now()+3600000)});
      assert.equal((await fetch(base+'/api/admin/access-users',{headers:{Authorization:`Bearer ${advisorToken}`}})).status,403);

      // Warehouse search keeps authentication and order access checks before legacy reads.
      assert.equal((await fetch(base+'/api/dispatch/tasks/warehouse-order/parts-stock?query=机油')).status,401);
      assert.equal((await call('/api/dispatch/tasks/absent/parts-stock/warehouses')).status,404);
      assert.equal((await call('/api/dispatch/tasks/warehouse-order/parts-stock?query=')).status,400);
      assert.equal((await fetch(base+'/api/dispatch/tasks/warehouse-order/parts-stock?query=机油',{headers:{Authorization:`Bearer ${advisorToken}`}})).status,403);
      assert.equal((await fetch(base+'/api/dispatch/tasks/warehouse-order/parts-history')).status,401);
      assert.equal((await call('/api/dispatch/tasks/absent/parts-history')).status,404);
      assert.equal((await call('/api/dispatch/tasks/warehouse-order/parts-history/stock?code=')).status,400);
      assert.equal((await fetch(base+'/api/dispatch/tasks/warehouse-order/parts-history',{headers:{Authorization:`Bearer ${advisorToken}`}})).status,403);
      const sqlHost=process.env.SQLSERVER_HOST;
      try {
        delete process.env.SQLSERVER_HOST;
        assert.equal((await call('/api/dispatch/tasks/warehouse-order/parts-stock?query=机油')).status,503);
        assert.equal((await call('/api/dispatch/tasks/warehouse-order/parts-stock/warehouses')).status,503);
        assert.equal((await call('/api/dispatch/tasks/warehouse-order/parts-history')).status,503);
      } finally {if(sqlHost===undefined)delete process.env.SQLSERVER_HOST;else process.env.SQLSERVER_HOST=sqlHost;}

      await pool.query("update users set active=false where id='manager'");
      assert.equal((await call('/api/dispatch/tasks')).status,401);
      await pool.query("update users set active=true where id='manager'");
    });
    await t.test('platform sync does not reset a dispatched repair item',async()=>{
      await seed('platform');let local=(await service.dispatchDetail(manager,'platform')).task;
      async function run(user,action,extra={}){local=(await service.executeDispatchAction(user,'platform',{action,expectedVersion:local.version,requestId:randomUUID(),...(action==='inspect'&&!extra.rejectedItemIds?.length?{workHours:2.5}:{}),...(action==='accept'?{partsRequirement:{mode:'none',items:[],photoIds:[]}}:{}),...extra})).task;}
      await run(dispatcher,'assign',{technicianId:'tech',dueAt});await run(tech,'accept');
      await pool.query("update work_orders set dispatch_no='A12345' where id='platform'");
      await syncWorkOrderToPlatform('platform',manager.name);
      assert.equal((await repo.getDispatchTask(pool,'platform',manager)).items[0].status,'维修中');
      assert.equal((await pool.query("select status from repair_items where order_id='platform' and client_item_id=1")).rows[0].status,'维修中');
    });
    await t.test('multiple employees share visibility, notifications and one completed order',async()=>{
      await seed('team');
      let team=(await service.executeDispatchAction(advisor,'team',{action:'assign',expectedVersion:0,requestId:randomUUID(),technicianIds:[tech.id,tech2.id],dueAt})).task;
      const execute=async(actor,action,extra={})=>{team=(await service.executeDispatchAction(actor,'team',{action,expectedVersion:team.version,requestId:randomUUID(),...(action==='inspect'&&!extra.rejectedItemIds?.length?{workHours:2.5}:{}),...(action==='accept'?{partsRequirement:{mode:'none',items:[],photoIds:[]}}:{}),...extra})).task;};
      assert.ok((await service.queryDispatchTasks(tech2)).some(t=>t.orderId==='team'));
      const {listWorkOrders}=await import('../server/db.mjs');
      assert.ok((await listWorkOrders('technician',tech2)).some(t=>t.id==='team'));
      assert.deepEqual((await pool.query("select recipient_id from dispatch_notifications where order_id='team' and kind='新派工' order by recipient_id")).rows.map(r=>r.recipient_id),[tech.id,tech2.id]);
      const file=randomUUID();
      await pool.query("insert into files(id,order_id,kind,storage_provider,bucket,object_key,original_name,mime_type,size_bytes,uploaded_by) values($1,'team','repair_order_photo','local','','test','repair.png','image/png',1,$2)",[file,advisor.id]);
      await assertFileReadAccess(file,tech2);
      await execute(tech2,'accept');
      await execute(tech2,'finish',{itemId:1});
      await execute(tech,'finish',{itemId:2});
      await assert.rejects(()=>execute(tech2,'submit',{inspectorId:inspector.id}),/本轮维修照片/);
      await progressPhoto('team');
      await execute(tech2,'submit',{inspectorId:inspector.id});await execute(inspector,'inspect');
      assert.equal((await service.queryDispatchTasks(advisor,{stage:'维修完成'})).filter(t=>t.orderId==='team').length,1);
      for(const person of [tech,tech2]) assert.ok((await service.queryDispatchTasks(advisor,{technicianId:person.id,stage:'维修完成'})).some(t=>t.orderId==='team'));
      await seed('team-reassign');
      let revised=(await service.executeDispatchAction(advisor,'team-reassign',{action:'assign',expectedVersion:0,requestId:randomUUID(),technicianIds:[tech.id,tech2.id],dueAt})).task;
      revised=(await service.executeDispatchAction(advisor,'team-reassign',{action:'reassign',expectedVersion:revised.version,requestId:randomUUID(),technicianIds:[tech2.id],dueAt,reason:'换班'})).task;
      assert.deepEqual(revised.technicianIds,[tech2.id]);
      await assert.rejects(()=>service.dispatchDetail(tech,'team-reassign'),e=>e.status===403);
      assert.ok(!(await listWorkOrders('technician',tech)).some(t=>t.id==='team-reassign'));
      await service.dispatchDetail(tech2,'team-reassign');
    });
    await t.test('draft team and outsourced plans round-trip and activate without a fictional technician',async()=>{
      const {saveDispatchPlan,readDispatchPlans}=await import('../server/repositories/dispatchPlanRepository.mjs');
      const {activateDispatchPlan}=await import('../server/services/dispatchPlanService.mjs');
      for(const [id,fields] of [['draft-team',{executionMode:'field',technicianIds:[tech.id,tech2.id],serviceUnit:'客户车队',serviceAddress:'客户停车场'}],['draft-outsourced',{executionMode:'outsourced',contractor:'外包维修厂',outsourcingMode:'offsite',agreedFee:500,handedOverAt:new Date().toISOString()}]]) {
        await seed(id);
        await database.transaction(async client=>{
          await saveDispatchPlan(client,{id,shop:{id:'shop-hq'}},advisor,{...fields,dueAt});
          const plan=(await readDispatchPlans(client,[id])).get(id);
          assert.equal(plan.executionMode,fields.executionMode);
          await activateDispatchPlan(client,{id,shop:{id:'shop-hq'}});
        });
        const task=(await service.dispatchDetail(advisor,id)).task;
        assert.equal(task.executionMode,fields.executionMode);assert.equal(task.stage,'待接单');
        if(fields.executionMode==='outsourced') {
          assert.equal(task.technicianId,undefined);assert.equal(task.agreedFee,500);
          assert.equal((await pool.query('select technician_id from work_order_dispatch_plans where order_id=$1',[id])).rows[0].technician_id,null);
          assert.ok((await pool.query('select recipient_id from dispatch_notifications where order_id=$1',[id])).rows.every(r=>![tech.id,tech2.id].includes(r.recipient_id)));
        } else assert.deepEqual(task.technicianIds,[tech.id,tech2.id]);
      }
    });
    await t.test('repair project edits retain prices and IDs and roll back together with rejected completion',async()=>{
      const id='editable-repair-items';await seed(id);
      let local=(await service.executeDispatchAction(advisor,id,{action:'assign',expectedVersion:0,requestId:randomUUID(),technicianIds:[tech.id],dueAt:new Date(Date.now()+86400000).toISOString()})).task;
      local=(await service.executeDispatchAction(tech,id,{action:'accept',expectedVersion:local.version,requestId:randomUUID(),partsRequirement:{mode:'none'}})).task;
      await pool.query('update repair_items set labor_fee=123 where order_id=$1 and client_item_id=1',[id]);
      const repairItems=[...local.items.map(item=>({id:item.id,name:`修改${item.name}`})),{name:'增修检查'}];
      const request={action:'edit-repair-items',expectedVersion:local.version,requestId:randomUUID(),repairItems};
      local=(await service.executeDispatchAction(tech,id,request)).task;await service.executeDispatchAction(tech,id,request);
      assert.equal(local.items.length,3);assert.equal(local.items[2].id,-1);
      const stored=(await pool.query('select client_item_id,name,labor_fee from repair_items where order_id=$1 order by item_no',[id])).rows;
      assert.equal(stored.length,3);assert.equal(Number(stored[0].labor_fee),123);assert.equal(stored[2].name,'增修检查');assert.equal(Number(stored[2].labor_fee),0);
      const completionRows=local.items.map(item=>({id:item.id,name:item.name+'完工核对'}));
      await assert.rejects(()=>service.executeDispatchAction(tech,id,{action:'submit-order',expectedVersion:local.version,requestId:randomUUID(),repairItems:completionRows}),/本轮维修照片/);
      assert.equal((await service.dispatchDetail(tech,id)).task.items[0].name,repairItems[0].name);
      assert.equal((await pool.query('select name from repair_items where order_id=$1 and client_item_id=1',[id])).rows[0].name,repairItems[0].name);
      await progressPhoto(id);
      local=(await service.executeDispatchAction(tech,id,{action:'submit-order',expectedVersion:local.version,requestId:randomUUID(),repairItems:completionRows})).task;
      assert.equal(local.stage,'待检验');assert.equal(local.items[0].name,completionRows[0].name);assert.ok(local.items.every(item=>item.status==='待检验'));
      const events=(await service.dispatchDetail(tech,id)).events.filter(e=>e.action==='edit-repair-items');assert.equal(events.length,1);assert.equal(events[0].detail.previousItems[0].name,'项目1');
      await pool.query("update dispatch_inspection_notifications set status='obsolete' where order_id=$1",[id]);
    });
    await t.test('dispatch board includes every open order and filters workflow stages',async()=>{
      for(const [id,status] of [['board-draft','草稿'],['board-signature','待客户签字'],['board-unassigned','已委托'],['board-unsettled','待结算'],['board-closed','完成']]) await seed(id,status);
      const ids=async query=>(await service.queryDispatchTasks(advisor,query)).map(t=>t.orderId);
      const all=await ids({});
      const internal=await ids({executionMode:'internal'}),field=await ids({executionMode:'field'}),outsourced=await ids({executionMode:'outsourced'});
      assert.ok(internal.length&&field.length&&outsourced.length,'all execution modes have fixtures');
      assert.deepEqual((await ids({executionMode:'internal,field'})).sort(),[...new Set([...internal,...field])].sort());
      assert.deepEqual((await ids({executionMode:'internal,field,outsourced'})).sort(),[...all].sort());
      assert.deepEqual((await ids({executionMode:'field,outsourced',search:'draft-'})).sort(),[...new Set([...field,...outsourced])].filter(id=>id.includes('draft-')).sort());
      await assert.rejects(()=>ids({executionMode:'field,invalid'}),e=>e.status===400);
      for(const id of ['board-draft','board-signature','board-unassigned','board-unsettled']) assert.ok(all.includes(id),id);
      assert.ok(!all.includes('board-closed'));
      assert.deepEqual((await ids({stage:'草稿'})).filter(id=>id.startsWith('board-')),['board-draft']);
      assert.deepEqual((await ids({stage:'待客户签字'})).filter(id=>id.startsWith('board-')),['board-signature']);
      assert.deepEqual((await ids({stage:'待派工'})).filter(id=>id.startsWith('board-')),['board-unassigned']);
      assert.deepEqual((await ids({stage:'待结算',from:'2000-01-01',to:'2000-01-02'})).filter(id=>id.startsWith('board-')),['board-unsettled']);
      assert.deepEqual((await ids({stage:'完成'})).filter(id=>id.startsWith('board-')),['board-closed']);
      await pool.query("update dispatch_tasks set data=jsonb_set(data,'{completedAt}','\"2000-01-01T00:00:00Z\"'::jsonb) where order_id='team'");
      assert.ok((await ids({})).includes('team'),'old completed repair still awaiting settlement stays visible');
      for(const id of ['board-draft','board-signature']) {
        const detail=await service.dispatchDetail(advisor,id);
        assert.ok(['草稿','待客户签字'].includes(detail.task.stage));
        await assert.rejects(()=>service.executeDispatchAction(advisor,id,{action:'assign',technicianIds:[tech.id],dueAt,expectedVersion:0,requestId:randomUUID()}),e=>e.status===409);
        await assert.rejects(()=>service.dispatchDetail(tech,id),e=>e.status===403);
        assert.equal((await pool.query('select 1 from dispatch_tasks where order_id=$1',[id])).rowCount,0);
      }
      let task=(await service.executeDispatchAction(advisor,'board-unassigned',{action:'assign',technicianIds:[tech.id],dueAt,expectedVersion:0,requestId:randomUUID()})).task;
      assert.ok((await ids({stage:'待接单'})).includes('board-unassigned'));
      task=(await service.executeDispatchAction(tech,'board-unassigned',{action:'accept',partsRequirement:{mode:'none',items:[],photoIds:[]},expectedVersion:task.version,requestId:randomUUID()})).task;
      assert.equal(task.stage,'维修中');
      assert.ok(!(await ids({stage:'待开工'})).includes('board-unassigned'));
      assert.ok((await ids({stage:'维修中'})).includes('board-unassigned'));
      assert.ok(!(await ids({stage:'待接单'})).includes('board-unassigned'));
    });
    await t.test('whole repair photo deduplication, queue fanout and concurrent inspection claim',async()=>{
      await pool.query("insert into users(id,name,role,shop_id,active) values('inspector2','第二检验员','inspector','shop-hq',true)");
      const otherInspector={...inspector,id:'inspector2',name:'第二检验员'};
      await seed('whole');
      let whole=(await service.executeDispatchAction(advisor,'whole',{action:'assign',expectedVersion:0,requestId:randomUUID(),technicianId:tech.id,dueAt})).task;
      const execute=async(actor,action,extra={})=>{whole=(await service.executeDispatchAction(actor,'whole',{action,expectedVersion:whole.version,requestId:randomUUID(),...(action==='inspect'&&!extra.rejectedItemIds?.length?{workHours:2.5}:{}),...(action==='accept'?{partsRequirement:{mode:'none',items:[],photoIds:[]}}:{}),...extra})).task;};
      await execute(tech,'accept');
      const {uploadRepairPhoto}=await import('../server/services/repairPhotoService.mjs');
      const {createFileRecord}=await import('../server/repositories/fileRepository.mjs');
      const save=async input=>createFileRecord({...input,storageProvider:'local',bucket:'local',objectKey:'test-photo',originalName:'photo.png',sizeBytes:8});
      const photoBody={requestId:randomUUID(),mimeType:'image/png',imageBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII='};
      await assert.rejects(()=>uploadRepairPhoto(outside,'whole',photoBody,{save}),e=>e.status===403);
      await assert.rejects(()=>uploadRepairPhoto(advisor,'whole',photoBody,{save}),e=>e.status===403);
      const versionBefore=whole.version;
      await progressPhoto('whole',0,'repair_order_photo');
      await progressPhoto('whole',0,'repair_parts_photo');
      await progressPhoto('whole',1);
      await assert.rejects(()=>execute(tech,'submit-order'),/本轮维修照片/);
      assert.equal((await service.dispatchDetail(manager,'whole')).task.version,versionBefore);
      const photo=await uploadRepairPhoto(tech,'whole',photoBody,{save});
      assert.equal((await uploadRepairPhoto(tech,'whole',photoBody,{save})).id,photo.id);
      assert.equal((await pool.query("select count(*) from files where order_id='whole' and kind='repair_progress_photo' and repair_round=0")).rows[0].count,'1');
      await execute(tech,'submit-order');assert.equal(whole.inspectorId,undefined);
      await assertFileReadAccess(photo.id,inspector);
      await assert.rejects(()=>uploadRepairPhoto(tech,'whole',{...photoBody,requestId:randomUUID()},{save}),e=>e.status===409);
      const {processInspectionNotifications}=await import('../server/workers/inspectionNotifications.mjs');
      await processInspectionNotifications();
      assert.equal((await pool.query("select count(*) from dispatch_notifications where order_id='whole' and kind='待检验'")).rows[0].count,'2');
      await processInspectionNotifications();
      assert.equal((await pool.query("select count(*) from dispatch_notifications where order_id='whole' and kind='待检验'")).rows[0].count,'2');
      const command={action:'claim-inspection',expectedVersion:whole.version,requestId:randomUUID()};
      const results=await Promise.allSettled([service.executeDispatchAction(inspector,'whole',command),service.executeDispatchAction(otherInspector,'whole',{...command,requestId:randomUUID()})]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      whole=(await service.dispatchDetail(manager,'whole')).task;
      const winner=whole.inspectorId===inspector.id?inspector:otherInspector;
      const stored=(await pool.query("select request_body from dispatch_events where order_id='whole' and action='claim-inspection'")).rows[0].request_body;
      await service.executeDispatchAction(winner,'whole',stored);
      await assert.rejects(()=>execute(winner,'inspect',{workHours:undefined}),/请填写实际工时/);
      assert.equal((await service.dispatchDetail(manager,'whole')).task.stage,'待检验');
      await execute(winner,'inspect',{workHours:3.75});assert.equal(whole.stage,'维修完成');
      assert.equal(whole.workHours,3.75);assert.equal(whole.workHoursRecordedBy,winner.id);
    });
    await t.test('acceptance requires parts, starts repair atomically and validates handwritten photo scope',async()=>{
      await seed('parts-accept');await seed('parts-other');
      await pool.query("update work_orders set vehicle_model='五菱',vehicle_mileage='57162',customer_name='托修单位测试',dispatch_no='A67469',arrival_date='2026-10-03' where id='parts-accept'");
      let local=(await service.executeDispatchAction(advisor,'parts-accept',{action:'assign',expectedVersion:0,requestId:randomUUID(),technicianId:tech.id,dueAt})).task;
      const command=(extra={})=>({action:'accept',expectedVersion:local.version,requestId:randomUUID(),...extra});
      await assert.rejects(()=>service.executeDispatchAction(tech,'parts-accept',command()),e=>e.status===400);
      assert.equal((await service.dispatchDetail(manager,'parts-accept')).task.stage,'待接单');
      const {uploadRepairPhoto}=await import('../server/services/repairPhotoService.mjs');
      const {createFileRecord}=await import('../server/repositories/fileRepository.mjs');
      const save=async data=>createFileRecord({...data,storageProvider:'local',bucket:'local',objectKey:'test-parts',originalName:'parts.png',sizeBytes:8});
      const photoBody={purpose:'parts',requestId:randomUUID(),repairRound:0,mimeType:'image/png',imageBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII='};
      await assert.rejects(()=>uploadRepairPhoto(outside,'parts-accept',photoBody,{save}),e=>e.status===403);
      await assert.rejects(()=>uploadRepairPhoto(tech,'parts-accept',{...photoBody,purpose:'progress'},{save}),e=>e.status===409);
      await assert.rejects(()=>uploadRepairPhoto(tech,'parts-accept',photoBody,{save:async()=>{throw new Error('模拟存储失败');}}),/模拟存储失败/);
      assert.equal((await service.dispatchDetail(manager,'parts-accept')).task.stage,'待接单');
      const photo=await uploadRepairPhoto(tech,'parts-accept',photoBody,{save});assert.equal((await uploadRepairPhoto(tech,'parts-accept',photoBody,{save})).id,photo.id);
      await assertFileReadAccess(photo.id,tech);await assert.rejects(()=>assertFileReadAccess(photo.id,outside),e=>e.status===403);
      const other=await createFileRecord({orderId:'parts-other',kind:'repair_parts_photo',storageProvider:'local',bucket:'local',objectKey:'other',originalName:'other.png',mimeType:'image/png',sizeBytes:8,uploadedBy:tech.id});
      await assert.rejects(()=>service.executeDispatchAction(tech,'parts-accept',command({partsRequirement:{mode:'photo',items:[],photoIds:[other.id]}})),e=>e.status===400);
      const previousRound=await createFileRecord({orderId:'parts-accept',kind:'repair_parts_photo',storageProvider:'local',bucket:'local',objectKey:'previous',originalName:'previous.png',mimeType:'image/png',sizeBytes:8,uploadedBy:tech.id});
      await pool.query('update files set repair_round=1 where id=$1',[previousRound.id]);
      await assert.rejects(()=>service.executeDispatchAction(tech,'parts-accept',command({partsRequirement:{mode:'photo',items:[],photoIds:[previousRound.id]}})),e=>e.status===400);
      const before=(await pool.query("select count(*) from dispatch_events where order_id='parts-accept'")).rows[0].count;
      const input=command({partsRequirement:{mode:'photo',items:[],photoIds:[photo.id]}});
      const responses=await Promise.all([service.executeDispatchAction(tech,'parts-accept',input),service.executeDispatchAction(tech,'parts-accept',input)]);
      local=responses[0].task;assert.equal(local.stage,'待开工');assert.equal(local.firstStartedAt,undefined);assert.ok(local.items.every(i=>i.status==='待开工'));
      assert.equal(local.partsRequirement.recordedBy,tech.id);assert.deepEqual(local.partsRequirement.photoIds,[photo.id]);
      assert.equal(Number((await pool.query("select count(*) from dispatch_events where order_id='parts-accept'")).rows[0].count),Number(before)+1);
      assert.equal(local.vehicleModel,'五菱');assert.equal(local.vehicleMileage,'57162');assert.equal(local.customerName,'托修单位测试');assert.equal(local.dispatchNo,'A67469');
      local=(await service.executeDispatchAction(tech,'parts-accept',{action:'record-parts',expectedVersion:local.version,requestId:randomUUID(),partsRequirement:{mode:'list',items:[{name:'机油',quantity:4,unit:'升'}],photoIds:[]}})).task;
      assert.equal(local.partsRequirement.items[0].quantity,4);assert.equal(local.stage,'待开工');
      const warehouse={id:'warehouse',name:'仓管',role:'warehouse',shopId:'shop-hq',active:true};
      for(const action of ['confirm-parts','issue-parts']) local=(await service.executeDispatchAction(warehouse,'parts-accept',{action,expectedVersion:local.version,requestId:randomUUID()})).task;
      assert.equal(local.stage,'维修中');assert.ok(local.items.every(i=>i.startedBy===tech.id));
      assert.equal((await pool.query("select count(*) from files where id=$1",[photo.id])).rows[0].count,'1');
      await assert.rejects(()=>service.executeDispatchAction(tech,'parts-accept',{action:'submit-order',expectedVersion:local.version,requestId:randomUUID()}),/本轮维修照片/);
      await progressPhoto('parts-accept');
      local=(await service.executeDispatchAction(tech,'parts-accept',{action:'submit-order',expectedVersion:local.version,requestId:randomUUID()})).task;assert.equal(local.stage,'待检验');
      await assertFileReadAccess(photo.id,inspector);
      await assert.rejects(()=>uploadRepairPhoto(tech,'parts-accept',{...photoBody,requestId:randomUUID()},{save}),e=>e.status===409);
      await assert.rejects(()=>service.executeDispatchAction(tech,'parts-accept',{action:'record-parts',expectedVersion:local.version,requestId:randomUUID(),partsRequirement:{mode:'none',items:[],photoIds:[]}}),e=>e.status===409);
      const records=(await service.dispatchDetail(advisor,'parts-accept')).events;
      assert.ok(records.some(e=>e.action==='record-parts'&&e.detail.partsRequirement.items[0].name==='机油'));
      await pool.query("update dispatch_inspection_notifications set status='obsolete' where order_id='parts-accept'");
    });
    await t.test('roster failures retain submitted tasks and empty audiences are explicit',async()=>{
      await seed('no-roster');
      let local=(await service.executeDispatchAction(advisor,'no-roster',{action:'assign',expectedVersion:0,requestId:randomUUID(),technicianId:tech.id,dueAt})).task;
      const run=async(actor,action,extra={})=>{local=(await service.executeDispatchAction(actor,'no-roster',{action,expectedVersion:local.version,requestId:randomUUID(),...(action==='inspect'&&!extra.rejectedItemIds?.length?{workHours:2.5}:{}),...(action==='accept'?{partsRequirement:{mode:'none',items:[],photoIds:[]}}:{})})).task;};
      await run(tech,'accept');await progressPhoto('no-roster');await run(tech,'submit-order');
      const {processInspectionNotifications}=await import('../server/workers/inspectionNotifications.mjs');
      const env={APP_ENV:'production',DISPATCH_NOTIFICATION_MODE:'dingtalk',DINGTALK_AGENT_ID:'1',DINGTALK_APP_KEY:'test',DINGTALK_APP_SECRET:'test',DISPATCH_APP_URL:'https://example.com'};
      await processInspectionNotifications({env,sync:async()=>{throw new Error('通讯录同步失败');}});
      assert.equal((await service.dispatchDetail(manager,'no-roster')).task.stage,'待检验');
      assert.match((await service.dispatchDetail(manager,'no-roster')).inspectionNotification.error,/同步失败/);
      await run(advisor,'retry-inspection-notifications');
      // Earlier errored jobs become obsolete before the newest submission resolves.
      await pool.query("update dispatch_inspection_notifications set next_attempt_at=now() where order_id='no-roster'");
      await processInspectionNotifications({env,sync:async()=>[]});await processInspectionNotifications({env,sync:async()=>[]});
      assert.match((await service.dispatchDetail(manager,'no-roster')).inspectionNotification.error,/暂无本店/);
      await pool.query("update users set inspector_role_member=false where id='inspector'");
      await assert.rejects(()=>service.executeDispatchAction(inspector,'no-roster',{action:'claim-inspection',expectedVersion:local.version,requestId:randomUUID()}),e=>e.status===403);
      await pool.query("update users set inspector_role_member=null where id='inspector'");
      await assert.rejects(()=>service.executeDispatchAction(outside,'no-roster',{action:'claim-inspection',expectedVersion:local.version,requestId:randomUUID()}),e=>e.status===403);
    });
    await t.test('my repair category counts match each list and exclude other technicians',async()=>{
      const counts=await service.myRepairCounts(tech);
      for(const [key,stage] of [['pendingAccept','待接单'],['inProgress','进行中'],['inspection','待检验'],['completed','维修完成']]) {
        assert.equal(counts[key],(await service.queryDispatchTasks(tech,{stage})).length);
      }
      await assert.rejects(()=>service.myRepairCounts(manager),e=>e.status===403);
      await assert.rejects(()=>service.myRepairCounts({...tech,active:false}),e=>e.status===403);
    });
    await t.test('refusal, pause and submission notify all same-store dispatchers and managers exactly once',async()=>{
      await pool.query("insert into users(id,name,role,shop_id,active) values('advisor2','另一派工员','advisor','shop-hq',true),('disabled-advisor','停用派工员','advisor','shop-hq',false)");
      await seed('scheduler-notices');
      let local=(await service.executeDispatchAction(advisor,'scheduler-notices',{action:'assign',expectedVersion:0,requestId:randomUUID(),technicianId:tech.id,dueAt})).task;
      const run=async(actor,action,extra={})=>{
        const command={action,expectedVersion:local.version,requestId:randomUUID(),...(action==='inspect'&&!extra.rejectedItemIds?.length?{workHours:2.5}:{}),...(action==='accept'?{partsRequirement:{mode:'none',items:[],photoIds:[]}}:{}),...extra};
        local=(await service.executeDispatchAction(actor,'scheduler-notices',command)).task;
        return command;
      };
      const refusal=await run(tech,'decline',{reason:'工作量已满'});
      await service.executeDispatchAction(tech,'scheduler-notices',refusal);
      await run(advisor,'reoffer');await run(tech,'accept');
      await run(tech,'pause',{pauseReason:'待配件',note:'滤芯缺货'});await run(tech,'resume');
      await progressPhoto('scheduler-notices');
      await run(tech,'submit-order');
      const {processSchedulerNotifications}=await import('../server/workers/schedulerNotifications.mjs');
      let syncCalls=0;
      while(await processSchedulerNotifications({sync:async()=>{syncCalls++;return [];}})) {}
      assert.equal(syncCalls,0,'mock mode never calls DingTalk');
      const expected=(await pool.query("select id from users where shop_id='shop-hq' and active and role in ('advisor','manager') order by id")).rows.map(r=>r.id);
      for(const kind of ['无法接单','维修暂停','维修已提检']) {
        const rows=(await pool.query("select recipient_id,payload from dispatch_notifications where order_id='scheduler-notices' and kind=$1 order by recipient_id",[kind])).rows;
        assert.deepEqual(rows.map(r=>r.recipient_id),expected);
        assert.equal(rows[0].payload.actorName,tech.name);
        if(kind==='维修暂停')assert.equal(rows[0].payload.reason,'待配件：滤芯缺货');
      }
      const count=Number((await pool.query("select count(*) from dispatch_notifications where order_id='scheduler-notices'")).rows[0].count);
      await processSchedulerNotifications();
      assert.equal(Number((await pool.query("select count(*) from dispatch_notifications where order_id='scheduler-notices'")).rows[0].count),count);
      await assert.rejects(()=>run(tech,'retry-scheduler-notifications',{notificationJobId:'1'}),e=>e.status===403);
      // A failing production roster must leave the repair action committed and retryable.
      await seed('scheduler-failure');
      let failed=(await service.executeDispatchAction(advisor,'scheduler-failure',{action:'assign',expectedVersion:0,requestId:randomUUID(),technicianId:tech.id,dueAt})).task;
      failed=(await service.executeDispatchAction(tech,'scheduler-failure',{action:'decline',expectedVersion:failed.version,requestId:randomUUID(),reason:'时间冲突'})).task;
      const env={APP_ENV:'production',DISPATCH_NOTIFICATION_MODE:'dingtalk',DINGTALK_AGENT_ID:'1',DINGTALK_APP_KEY:'test',DINGTALK_APP_SECRET:'test',DISPATCH_APP_URL:'https://example.com'};
      await processSchedulerNotifications({env,sync:async()=>{throw new Error('通讯录无权限');}});
      const detail=await service.dispatchDetail(manager,'scheduler-failure');
      assert.equal(detail.task.feedback,'时间冲突');assert.match(detail.schedulerNotifications[0].error,/无权限/);
      await service.executeDispatchAction(advisor,'scheduler-failure',{action:'retry-scheduler-notifications',expectedVersion:failed.version,requestId:randomUUID(),notificationJobId:detail.schedulerNotifications[0].eventId});
      await processSchedulerNotifications({env,sync:async()=>[advisor.id,manager.id,'outside','disabled-advisor']});
      assert.deepEqual((await pool.query("select recipient_id from dispatch_notifications where order_id='scheduler-failure' and kind='无法接单' order by recipient_id")).rows.map(r=>r.recipient_id),[advisor.id,manager.id].sort());
    });
    await t.test('three deadline batches deduplicate across concurrent workers, recipients and rescheduling',async()=>{
      const now=Date.now(),deadline=new Date(now+48*3600000).toISOString();
      await seed('deadline');
      let local=(await service.executeDispatchAction(advisor,'deadline',{action:'assign',expectedVersion:0,requestId:randomUUID(),technicianIds:[tech.id,tech2.id],dueAt:deadline})).task;
      const {queueDueReminders,validateDueReminder}=await import('../server/workers/dueReminders.mjs');
      await Promise.all([queueDueReminders({now}),queueDueReminders({now})]);
      const count=async()=>Number((await pool.query("select count(*) from dispatch_notifications where order_id='deadline' and kind='即将到期'")).rows[0].count);
      assert.equal(await count(),2);
      await queueDueReminders({now:now+24*3600000});await queueDueReminders({now:now+24*3600000});assert.equal(await count(),4);
      await queueDueReminders({now:now+47*3600000});await queueDueReminders({now:now+47*3600000});assert.equal(await count(),6);
      const windows=(await pool.query("select lead_minutes,count(*)::integer as count from dispatch_due_reminders where order_id='deadline' group by lead_minutes order by lead_minutes")).rows;
      assert.deepEqual(windows,[{lead_minutes:60,count:2},{lead_minutes:1440,count:2},{lead_minutes:2880,count:2}]);
      const last=(await pool.query("select * from dispatch_notifications where order_id='deadline' and recipient_id=$1 and payload->>'leadMinutes'='60'",[tech.id])).rows[0];
      assert.equal(await validateDueReminder(last,tech,{now:now+47*3600000}),true);
      const newDue=new Date(now+49*3600000).toISOString();
      local=(await service.executeDispatchAction(advisor,'deadline',{action:'update',expectedVersion:local.version,requestId:randomUUID(),dueAt:newDue})).task;
      assert.equal(await validateDueReminder(last,tech,{now:now+47*3600000}),false);
      await queueDueReminders({now:now+47*3600000});assert.equal(await count(),8);
      local=(await service.executeDispatchAction(advisor,'deadline',{action:'reassign',expectedVersion:local.version,requestId:randomUUID(),technicianId:unique.id,dueAt:newDue,reason:'换班'})).task;
      await queueDueReminders({now:now+47*3600000});assert.equal(await count(),9);
      assert.equal((await pool.query("select count(*) from dispatch_events where order_id='deadline' and action='due-reminder' and actor_id is not null")).rows[0].count,'0');
      await queueDueReminders({now:now+50*3600000});assert.equal(await count(),9,'overdue orders receive no new upcoming notices');
      // Newly created orders already within one hour only receive the one-hour batch.
      await seed('last-hour');
      const soon=new Date(now+1800000).toISOString();
      await service.executeDispatchAction(advisor,'last-hour',{action:'assign',expectedVersion:0,requestId:randomUUID(),technicianId:tech.id,dueAt:soon});
      await queueDueReminders({now});
      assert.deepEqual((await pool.query("select lead_minutes from dispatch_due_reminders where order_id='last-hour'")).rows,[{lead_minutes:60}]);
      await pool.query("update dispatch_tasks set stage='待检验' where order_id='last-hour'");
      const queued=(await pool.query("select * from dispatch_notifications where order_id='last-hour' and kind='即将到期'")).rows[0];
      assert.equal(await validateDueReminder(queued,tech,{now}),false);
    });
    if(process.env.DISPATCH_UI_TEST==='true') await t.test('desktop and mobile UI complete assignment, acceptance, repair and inspection',async()=>{
      const {chromium}=await import(process.env.DISPATCH_PLAYWRIGHT_MODULE||'playwright');
      const {createTokenForUser}=await import('../server/auth.mjs');
      const {createAuthSession}=await import('../server/repositories/userRepository.mjs');
      const browser=await chromium.launch({headless:true,executablePath:process.env.DISPATCH_CHROME_PATH});
      const base=`http://127.0.0.1:${server.address().port}`;
      const browserErrors=[];
      const pages=[];
      try {
        await seed('ui-order');
        await seed('ui-filter-unassigned');
        async function pageFor(user,mobile=false,orderId='ui-order'){
          const token=createTokenForUser(user.id);await createAuthSession({token,userId:user.id,expiresAt:new Date(Date.now()+3600000)});
          const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile});
          const page=await context.newPage();pages.push(page);page.setDefaultTimeout(12000);page.on('pageerror',e=>browserErrors.push(e.message));
          await page.addInitScript(token=>localStorage.setItem('repair-h5-auth-token',token),token);
          await page.goto(`${base}/?dispatchOrder=${orderId}`);return page;
        }
        const managerPage=await pageFor(manager);
        await managerPage.locator('.ant-drawer-close').click();
        await managerPage.locator('.ant-drawer-section').waitFor({state:'hidden'});
        const selectStatus=async label=>{await managerPage.getByRole('combobox',{name:'工单状态筛选'}).click();await managerPage.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({hasText:new RegExp(`^${label}$`)}).click();};
        await selectStatus('未派工');
        await managerPage.locator('.dispatch-page .ant-table').last().getByText('ui-filter-unassigned',{exact:true}).waitFor();
        await selectStatus('待结算');
        await managerPage.locator('.dispatch-page .ant-table').last().getByText('board-unsettled',{exact:true}).waitFor();
        await selectStatus('草稿');
        const draftRow=managerPage.locator('.dispatch-page .ant-table').last().locator('tr').filter({hasText:'board-draft'});
        await draftRow.getByRole('button',{name:/^详\s*情$/}).click();
        await managerPage.getByText('客户签字后才能派工',{exact:true}).waitFor();
        assert.equal(await managerPage.locator('.dispatch-detail').getByRole('button',{name:'指派维修工',exact:true}).count(),0);
        await managerPage.locator('.ant-drawer-close').click();
        await managerPage.locator('.ant-drawer-section').waitFor({state:'hidden'});
        await managerPage.getByRole('button',{name:'重置筛选',exact:true}).click();
        await managerPage.goto(`${base}/?dispatchOrder=ui-order`);
        const managerDrawer=managerPage.locator('.dispatch-detail');
        await managerDrawer.getByRole('button',{name:'指派维修工',exact:true}).click();
        const dialog=managerPage.getByRole('dialog',{name:'指派维修工',exact:true});
        await dialog.getByRole('combobox',{name:'执行方式',exact:true}).click();
        await managerPage.locator('.ant-select-item-option-content').filter({hasText:'外修（员工外派）'}).click();
        await dialog.getByLabel('服务单位',{exact:true}).fill('客户车队');
        await dialog.getByLabel('施工地址',{exact:true}).fill('客户停车场');
        await dialog.getByRole('combobox',{name:'维修工',exact:true}).click();
        await managerPage.locator('.ant-select-item-option-content').filter({hasText:'同名技师'}).first().click();
        await managerPage.locator('.ant-select-item-option-content').filter({hasText:'同名技师'}).nth(1).click();
        await dialog.getByLabel('预计完工时间',{exact:true}).fill('2026-12-31T18:00');
        await dialog.getByRole('button',{name:/^确\s*认$/}).click();
        await dialog.waitFor({state:'hidden'});
        let ui=(await service.dispatchDetail(manager,'ui-order')).task;
        assert.equal(ui.stage,'待接单');assert.equal(ui.executionMode,'field');assert.equal(ui.technicianIds.length,2);
        const uiTech=people.find(p=>p.id===ui.technicianIds[1]);
        const workerPage=await pageFor(uiTech,true);
        const drawer=workerPage.locator('.dispatch-detail');
        await drawer.getByRole('button',{name:'确认接单',exact:true}).click();
        for(const itemId of [1,2]) {
          await drawer.getByRole('button',{name:`开工：项目${itemId}`,exact:true}).click();
          await drawer.getByRole('button',{name:`项目完成：项目${itemId}`,exact:true}).click();
        }
        await drawer.getByRole('button',{name:'提报检验',exact:true}).click();
        const workerDialog=workerPage.getByRole('dialog',{name:'提报检验',exact:true});
        await workerDialog.getByRole('combobox',{name:'指定检验员',exact:true}).click();
        await workerPage.locator('.ant-select-item-option-content').filter({hasText:/^检验员$/}).click();
        await workerDialog.getByRole('button',{name:/^确\s*认$/}).click();
        await workerDialog.waitFor({state:'hidden'});
        ui=(await service.dispatchDetail(manager,'ui-order')).task;assert.equal(ui.stage,'待检验');
        const inspectorPage=await pageFor(inspector,true);
        await inspectorPage.locator('.dispatch-detail').getByRole('button',{name:'检验处理',exact:true}).click();
        const inspectionDialog=inspectorPage.getByRole('dialog',{name:'检验处理',exact:true});
        await inspectionDialog.getByRole('button',{name:/^确\s*认$/}).click();
        await inspectionDialog.waitFor({state:'hidden'});
        assert.equal((await service.dispatchDetail(manager,'ui-order')).task.stage,'维修完成');
        await fs.mkdir('/tmp/repair-dispatch-qa',{recursive:true});
        await workerPage.screenshot({path:'/tmp/repair-dispatch-qa/mobile.png'});
        await managerPage.locator('.ant-drawer-close').click();
        await managerPage.locator('.ant-drawer-section').waitFor({state:'hidden'});
        await managerPage.screenshot({path:'/tmp/repair-dispatch-qa/desktop.png',fullPage:true});
        assert.equal(await workerPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'mobile page has no horizontal overflow');
        for(const outsourcingMode of ['onsite','offsite']) {
          const id=`ui-outsourced-${outsourcingMode}`;await seed(id);
          const page=await pageFor(advisor,true,id);
          await page.locator('.dispatch-detail').getByRole('button',{name:'指派维修工',exact:true}).click();
          const form=page.getByRole('dialog',{name:'指派维修工',exact:true});
          await form.getByRole('combobox',{name:'执行方式',exact:true}).click();
          await page.locator('.ant-select-item-option-content').filter({hasText:/^外包$/}).click();
          if(outsourcingMode==='offsite') {
            await form.getByRole('combobox',{name:'外包施工方式',exact:true}).click();
            await page.locator('.ant-select-item-option-content').filter({hasText:'车辆外送整包维修'}).click();
            await form.getByLabel('交车时间',{exact:true}).fill('2026-09-14T10:00');
            await form.getByLabel('收车时间',{exact:true}).fill('2026-09-15T10:00');
          }
          await form.getByLabel('承包方',{exact:true}).fill('测试外包单位');
          await form.getByLabel('约定费用',{exact:true}).fill('500');
          await form.getByLabel('预计完工时间',{exact:true}).fill('2026-12-31T18:00');
          await page.screenshot({path:`/tmp/repair-dispatch-qa/${outsourcingMode}-form-mobile.png`});
          await form.getByRole('button',{name:/^确\s*认$/}).click();await form.waitFor({state:'hidden'});
          const task=(await service.dispatchDetail(advisor,id)).task;
          assert.equal(task.executionMode,'outsourced');assert.equal(task.outsourcingMode,outsourcingMode);assert.equal(task.agreedFee,500);
          await page.locator('.dispatch-detail').getByRole('button',{name:'确认接单',exact:true}).click();
          await page.locator('.dispatch-detail').getByRole('button',{name:'开工：项目1',exact:true}).waitFor();
          await page.screenshot({path:`/tmp/repair-dispatch-qa/${outsourcingMode}-mobile.png`});
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        }
        assert.deepEqual(browserErrors,[]);
      } catch(e) {for(const page of pages){console.log('UI state:',await page.locator('body').innerText());console.log('Buttons:',await page.locator('.dispatch-detail button').evaluateAll(nodes=>nodes.map(n=>({html:n.outerHTML,hiddenAncestor:n.closest('[aria-hidden=true]')?.className}))));await fs.mkdir('/tmp/repair-dispatch-qa',{recursive:true});await page.screenshot({path:'/tmp/repair-dispatch-qa/failure.png',fullPage:true});}console.log('Browser errors:',browserErrors);throw e;} finally {await browser.close();}
    });
  } finally {
    if(server) await new Promise(resolve=>server.close(resolve));
    await Promise.allSettled([...inFlight]);
    if(pool) await pool.end();
    await Promise.all(connectionsClosed);
    if(/^codex_dispatch_test_\d+_\d+$/.test(name)) await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.end();
  }
});
