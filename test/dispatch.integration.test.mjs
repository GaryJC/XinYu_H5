import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import path from 'node:path';
import os from 'node:os';
import pg from 'pg';
const adminUrl=process.env.DISPATCH_TEST_ADMIN_URL;
// Opt-in only: never infer a database from .env or touch application data.
test('dispatch PostgreSQL migrations, concurrency, HTTP permissions and notification leases', {skip:!adminUrl,timeout:180000}, async t=>{
  const parsed=new URL(adminUrl);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(parsed.hostname),'Only a local test server is allowed');
  const name=`codex_dispatch_test_${process.pid}_${Date.now()}`;
  const admin=new pg.Client({connectionString:adminUrl,connectionTimeoutMillis:5000});
  let pool,server,uiUploadRoot;
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
    await pool.query("update users set legacy_employee_code='027',legacy_employee_name=name,legacy_employee_department='test',legacy_employee_bound_at=now() where role='technician'");
    await pool.query("insert into users(id,name,role,shop_id,active) values('external','测试外包单位','outsourcing','shop-hq',true)");
    dispatcher.role='advisor';
    const service=await import('../server/services/dispatchService.mjs');
    async function drainInspectionNotifications(options) {
      const {processInspectionNotifications}=await import('../server/workers/inspectionNotifications.mjs');
      for(let count=0;count<200;count++)if(!await processInspectionNotifications(options))return;
      assert.fail('Inspection notification queue did not drain');
    }
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
    const db=await import('../server/db.mjs');
    await t.test('draft preselection activates only after signature approval, retains actor and is atomic with Runfeng submission',async()=>{
      const plan={technicianId:tech.id,dueAt,urgent:true,note:'开单预选'};
      const draft={shop:{id:'shop-hq'},department:{code:'D1',name:'维修部'},vehicle:{plate:'鲁B12345',vin:'LSVAA4182C2187611',mileage:'12000',model:'测试车型',modelLegacyCode:'M1'},customer:{name:'测试车主',legacyCode:'C1',phone:'13800000000'},advisor:advisor.name,dispatchPlan:plan,repairItems:[{id:1,name:'保养',status:'待派工'}]};
      let order=await db.createWorkOrder(draft,advisor.name,advisor);
      assert.equal(order.dispatchPlan.technicianId,tech.id);
      assert.equal((await pool.query('select 1 from dispatch_tasks where order_id=$1',[order.id])).rowCount,0);
      assert.equal((await pool.query("select 1 from dispatch_notifications where order_id=$1 and kind<>'需确认用户签字'",[order.id])).rowCount,0);
      order=await db.updateWorkOrder({...order,dispatchPlan:null},advisor.name,'清除预选',advisor);
      assert.equal(order.dispatchPlan,undefined);
      await assert.rejects(()=>db.updateWorkOrder({...order,dispatchPlan:{...plan,technicianId:outside.id}},advisor.name,'跨店',advisor),e=>e.status===400);
      order=await db.updateWorkOrder({...order,dispatchPlan:plan},advisor.name,'预选',advisor);
      async function prepareSignature(order) {
        const front45=await progressPhoto(order.id,0,'repair_order_photo'),rear45=await progressPhoto(order.id,0,'repair_order_photo');
        await pool.query('update work_orders set inspection=$2 where id=$1',[order.id,{preRepairPhotos:{front45,rear45}}]);
        await pool.query("update work_orders set status='待客户签字' where id=$1",[order.id]);
        const token=randomUUID(),file=randomUUID();
        await pool.query('insert into signature_tokens(token,order_id) values($1,$2)',[token,order.id]);
        await pool.query("insert into files(id,order_id,kind,storage_provider,bucket,object_key,original_name,mime_type,size_bytes,uploaded_by) values($1,$2,'signature_image','local','','test','signature.png','image/png',1,$3)",[file,order.id,advisor.id]);
        return {token,file};
      }
      const signature=await prepareSignature(order);
      const unsigned=await db.findWorkOrderById(pool,order.id);
      const edited=await db.updateWorkOrder({...unsigned,vehicle:{...unsigned.vehicle,plate:'鲁B862P7',vin:'LZWADAGA8NB072733'}},advisor.name,'签字前修正车辆',advisor);
      assert.equal(edited.status,'待客户签字');assert.equal(edited.vehicle.plate,'鲁B862P7');assert.equal(edited.vehicle.vin,'LZWADAGA8NB072733');
      assert.equal((await pool.query('select 1 from legacy_sync_outbox where order_id=$1',[order.id])).rowCount,0);
      await assert.rejects(()=>db.signWorkOrderByToken(signature.token,{name:'旧预览'},signature.file),e=>[404,409,410].includes(e.status));
      const renewed=await db.createSignatureTokenForOrder(order.id,advisor.name);
      assert.notEqual(renewed.signatureToken,signature.token);signature.token=renewed.signatureToken;
      const pending=await db.signWorkOrderByToken(signature.token,{name:'车主',signedAt:new Date().toISOString()},signature.file);
      await assert.rejects(()=>db.updateWorkOrder({...edited,vehicle:{...edited.vehicle,plate:'鲁B00000'}},advisor.name,'旧页面提交',advisor),e=>e.status===409);
      assert.equal((await pool.query('select 1 from legacy_sync_outbox where order_id=$1',[order.id])).rowCount,0);
      assert.equal((await db.findWorkOrderById(pool,order.id)).vehicle.plate,'鲁B862P7');
      assert.equal(pending.status,'待客户签字');
      const signed=await db.confirmCustomerSignature(order.id,advisor);
      assert.equal(signed.status,'待派工');
      assert.equal(signed.technician,tech.name);
      const assigned=(await service.dispatchDetail(advisor,order.id)).task;
      assert.equal(assigned.stage,'待接单');assert.equal(assigned.assignedBy,advisor.id);assert.equal(assigned.urgent,true);
      assert.equal((await pool.query("select 1 from dispatch_notifications where order_id=$1 and kind<>'需确认用户签字'",[order.id])).rowCount,1);
      assert.equal((await pool.query('select 1 from legacy_sync_outbox where order_id=$1',[order.id])).rowCount,1);
      await assert.rejects(()=>db.signWorkOrderByToken(signature.token,{},signature.file),e=>e.status===409);
      assert.equal((await pool.query("select 1 from dispatch_notifications where order_id=$1 and kind<>'需确认用户签字'",[order.id])).rowCount,1);
      const fallback=await db.createWorkOrder(draft,advisor.name,advisor);
      const secondSignature=await prepareSignature(fallback);
      await pool.query("update users set active=false where id=$1",[tech.id]);
      await db.signWorkOrderByToken(secondSignature.token,{name:'车主'},secondSignature.file);
      const saved=await db.confirmCustomerSignature(fallback.id,advisor);
      assert.equal(saved.status,'已委托');assert.ok(saved.dispatchPlan.activationError);
      assert.equal((await pool.query("select 1 from dispatch_notifications where order_id=$1 and kind<>'需确认用户签字'",[fallback.id])).rowCount,0);
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
      await pool.query("update work_orders set vehicle_vin='VIN-WAREHOUSE',vehicle_model='仓管车型' where id='warehouse-order'");
      const task=(await service.dispatchDetail(warehouse,'warehouse-order')).task;
      assert.equal(task.vehicleVin,'VIN-WAREHOUSE');assert.equal(task.vehicleModel,'仓管车型');
      const warehouseOrder=await db.getWorkOrderDetail('warehouse-order',warehouse);
      assert.equal(warehouseOrder.vehicle.vin,'VIN-WAREHOUSE');assert.equal(warehouseOrder.signatureToken,undefined);
      await assert.rejects(()=>db.getWorkOrderDetail('warehouse-order',{...warehouse,shopId:'other'}),e=>e.status===403);

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
      assert.equal(added.task.stage,'维修中');assert.equal(added.task.partsRequirement.batch,3);assert.equal(added.task.partsRequirement.issuedAt,undefined);
      assert.ok(added.events.some(e=>e.action==='issue-parts'&&e.detail.partsRequirement.items[0].name==='滤芯'));
      assert.equal((await pool.query("select 1 from outbound_orders where order_id='warehouse-order'")).rowCount,0);
    });
    await t.test('warehouse edits are idempotent before preparation and reject completed batches',async()=>{
      const warehouse={id:'warehouse',name:'仓管',role:'warehouse',shopId:'shop-hq',active:true};
      await seed('warehouse-edit');
      const run=(user,action,version,extra={})=>service.executeDispatchAction(user,'warehouse-edit',{action,expectedVersion:version,requestId:randomUUID(),...extra});
      await run(manager,'assign',0,{technicianId:tech.id,dueAt});
      const accepted=await run(tech,'accept',1,{partsRequirement:{mode:'list',items:[{name:'机油',quantity:4,unit:'升'}]}});
      const command={action:'edit-parts',expectedVersion:accepted.task.version,requestId:randomUUID(),partsRequirement:{mode:'list',items:[{name:'机油 SN5W30',quantity:4,unit:'升'},{name:'机油滤清器',quantity:1,unit:'只'}]}};
      const [updated]=await Promise.all([service.executeDispatchAction(warehouse,'warehouse-edit',command),service.executeDispatchAction(warehouse,'warehouse-edit',command)]);
      await service.executeDispatchAction(warehouse,'warehouse-edit',{...command,partsRequirement:{items:command.partsRequirement.items.map(i=>({unit:i.unit,quantity:i.quantity,name:i.name})),mode:'list'}});
      await assert.rejects(()=>service.executeDispatchAction(warehouse,'warehouse-edit',{...command,partsRequirement:{...command.partsRequirement,items:[{name:'different',quantity:1,unit:'个'}]}}),e=>e.status===409);
      assert.equal(updated.task.partsRequirement.items.length,2);assert.equal(updated.task.partsRequirement.preparedAt,undefined);assert.equal(updated.task.stage,'待开工');
      assert.equal((await pool.query("select 1 from dispatch_events where order_id='warehouse-edit' and action='edit-parts'")).rowCount,1);
      assert.equal((await pool.query("select 1 from dispatch_notifications where order_id='warehouse-edit' and kind='配件需求已调整' and recipient_id='tech'")).rowCount,1);
      await assert.rejects(()=>run(warehouse,'issue-parts',updated.task.version),e=>e.status===409);
      await assert.rejects(()=>run(warehouse,'edit-parts',accepted.task.version,{partsRequirement:{mode:'none'}}),e=>e.status===409);
      const none=await run(warehouse,'edit-parts',updated.task.version,{partsRequirement:{mode:'none'}});
      assert.equal(none.task.stage,'维修中');assert.ok(none.task.items.every(i=>i.startedBy===tech.id));assert.ok(!none.task.participantIds.includes('warehouse'));
      const requested=await run(tech,'record-parts',none.task.version,{partsRequirement:command.partsRequirement});
      const prepared=await run(warehouse,'confirm-parts',requested.task.version);
      await assert.rejects(()=>run(warehouse,'edit-parts',prepared.task.version,{partsRequirement:{mode:'none'}}),/已完成配件不可修改/);
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
      const selectable=await (await call('/api/dispatch/people')).json();
      assert.ok(selectable.inspectors.some(person=>person.id===manager.id),'manager can select self for independent inspection');
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
      await execute(advisor,'edit-repair-items',{repairItems:team.items.map((i,n)=>({id:i.id,name:i.name,responsibleId:n?tech.id:tech2.id}))});
      await execute(tech2,'accept');
      await execute(tech,'record-parts',{partsRequirement:{mode:'none'}});
      await assert.rejects(()=>execute(tech2,'finish',{itemId:1}),/提交本人完工/);
      await assert.rejects(()=>execute(tech2,'submit-order'),/本轮维修照片/);
      await progressPhoto('team');
      // A coworker's photo cannot satisfy this worker's submission requirement.
      await assert.rejects(()=>execute(tech2,'submit-order'),/本轮维修照片/);
      const ownPhoto=await progressPhoto('team');
      await pool.query('update files set uploaded_by=$1 where id=$2',[tech2.id,ownPhoto]);
      await execute(tech2,'submit-order');
      assert.equal(team.stage,'维修中');
      await execute(inspector,'claim-inspection');
      const claim=team.inspectionClaimedAt;
      await execute(tech,'submit-order');
      assert.equal(team.inspectorId,inspector.id);assert.equal(team.inspectionClaimedAt,claim);
      await execute(inspector,'inspect');
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
    await t.test('team pause, preparation, concurrent submissions and idempotent retry persist independently',async()=>{
      const id='team-interleave',warehouse={id:'warehouse',name:'仓管',role:'warehouse',shopId:'shop-hq',active:true};
      await seed(id);
      let current=(await service.dispatchDetail(advisor,id)).task;
      const run=async(actor,action,extra={})=>{current=(await service.executeDispatchAction(actor,id,{action,expectedVersion:current.version,requestId:randomUUID(),...extra})).task;};
      await run(advisor,'assign',{technicianIds:[tech.id,tech2.id],dueAt,repairItems:current.items.map((item,index)=>({...item,responsibleId:index?tech2.id:tech.id}))});
      await run(tech,'accept',{partsRequirement:{mode:'list',items:[{name:'滤芯',quantity:1,unit:'个'}]}});
      await run(tech,'pause',{pauseReason:'待配件'});
      await run(tech2,'record-parts',{partsRequirement:{mode:'none'}});
      const coworker=structuredClone(current.items[1]);
      await run(warehouse,'confirm-parts',{partsOwnerId:tech.id});
      assert.equal(current.workerPauses[tech.id].resumeStage,'维修中');
      assert.deepEqual(current.items[1],coworker);
      await run(tech,'resume');assert.equal(current.workerPauses[tech.id],undefined);
      await progressPhoto(id);
      const photo=await progressPhoto(id);await pool.query('update files set uploaded_by=$1 where id=$2',[tech2.id,photo]);
      const version=current.version;
      const commands=[tech,tech2].map(actor=>({actor,input:{action:'submit-order',expectedVersion:version,requestId:randomUUID()}}));
      const results=await Promise.allSettled(commands.map(({actor,input})=>service.executeDispatchAction(actor,id,input)));
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
      current=(await service.dispatchDetail(advisor,id)).task;
      assert.equal(current.items.filter(i=>i.status==='待检验').length,1);
      assert.equal((await pool.query('select 1 from repair_writebacks where order_id=$1',[id])).rowCount,0);
      const winner=results.findIndex(r=>r.status==='fulfilled'),loser=1-winner;
      await service.executeDispatchAction(commands[winner].actor,id,commands[winner].input);
      assert.equal((await service.dispatchDetail(advisor,id)).task.version,current.version);
      await run(inspector,'claim-inspection');
      await run(commands[loser].actor,'submit-order');
      assert.equal(current.inspectorId,inspector.id);
      assert.equal(Object.keys(current.workerSubmissions).length,2);
      await run(inspector,'inspect',{workHours:2});
      assert.equal(current.stage,'维修完成');
      assert.equal((await pool.query('select 1 from repair_writebacks where order_id=$1',[id])).rowCount,1);
    });
    await t.test('draft team and outsourced plans round-trip and activate without a fictional technician',async()=>{
      const {saveDispatchPlan,readDispatchPlans}=await import('../server/repositories/dispatchPlanRepository.mjs');
      const {activateDispatchPlan}=await import('../server/services/dispatchPlanService.mjs');
      for(const [id,fields] of [['draft-team',{executionMode:'field',technicianIds:[tech.id,tech2.id],serviceUnit:'客户车队',serviceAddress:'客户停车场'}],['draft-outsourced',{executionMode:'outsourced',contractorId:'external',contractor:'测试外包单位',outsourcingMode:'offsite',agreedFee:500,handedOverAt:new Date().toISOString()}]]) {
        await seed(id);
        await database.transaction(async client=>{
          await saveDispatchPlan(client,{id,shop:{id:'shop-hq'}},advisor,{...fields,dueAt});
          const plan=(await readDispatchPlans(client,[id])).get(id);
          assert.equal(plan.executionMode,fields.executionMode);
          await activateDispatchPlan(client,{id,shop:{id:'shop-hq'},repairItems:[{id:1,name:'项目1'},{id:2,name:'项目2'}]});
        });
        const task=(await service.dispatchDetail(advisor,id)).task;
        assert.equal(task.executionMode,fields.executionMode);assert.equal(task.stage,'待接单');
        if(fields.executionMode==='outsourced') {
          assert.equal(task.technicianId,'external');assert.equal(task.agreedFee,500);
          assert.equal((await pool.query('select technician_id from work_order_dispatch_plans where order_id=$1',[id])).rows[0].technician_id,'external');
          assert.ok((await pool.query('select recipient_id from dispatch_notifications where order_id=$1',[id])).rows.every(r=>![tech.id,tech2.id].includes(r.recipient_id)));
        } else assert.deepEqual(task.technicianIds,[tech.id,tech2.id]);
      }
    });
    await t.test('scheduler project edits and selective reassignment persist owners, audit and affected notifications atomically',async()=>{
      const id='scheduler-project-dispatch';await seed(id);
      let local=(await service.executeDispatchAction(advisor,id,{action:'assign',expectedVersion:0,requestId:randomUUID(),technicianIds:[tech.id,tech2.id],dueAt,repairItems:[{id:1,name:'更换机油',responsibleId:tech.id},{id:2,name:'检查刹车',responsibleId:tech2.id}]})).task;
      local=(await service.executeDispatchAction(tech,id,{action:'accept',expectedVersion:local.version,requestId:randomUUID(),partsRequirement:{mode:'none'}})).task;
      await pool.query('update repair_items set labor_fee=123 where order_id=$1 and client_item_id=1',[id]);
      const before=structuredClone(local);
      const request={action:'reassign',reassignItemIds:[1],repairItems:[{id:1,name:local.items[0].name,responsibleId:unique.id}],reason:'指定项目交接',expectedVersion:local.version,requestId:randomUUID()};
      local=(await service.executeDispatchAction(advisor,id,request)).task;
      await service.executeDispatchAction(advisor,id,request);
      assert.deepEqual(local.items[1],before.items[1]);assert.equal(local.items[0].responsibleId,unique.id);
      assert.equal(local.items[0].startedBy,tech.id);assert.equal(local.items[0].startAt,before.items[0].startAt);
      for(const key of ['stage','acceptedAt','firstStartedAt','dueAt'])assert.equal(local[key],before[key]);
      assert.ok(local.technicianIds.includes(tech2.id));assert.ok(local.participantIds.includes(tech.id));
      const event=(await pool.query("select id,detail from dispatch_events where order_id=$1 and action='reassign'",[id])).rows;
      assert.equal(event.length,1);assert.deepEqual(event[0].detail.reassignItemIds,[1]);assert.equal(event[0].detail.previousItems[0].responsibleId,tech.id);
      const notices=(await pool.query('select recipient_id,kind,payload from dispatch_notifications where event_id=$1',[event[0].id])).rows;
      assert.deepEqual(notices.map(n=>n.recipient_id).sort(),[tech.id,unique.id].sort());assert.ok(notices.every(n=>n.kind==='项目改派'&&!n.payload.summary.includes('检查刹车')));
      const updated=local.items.map(({id,name,responsibleId})=>({id,name,responsibleId}));updated[0].name='更换机油机滤';updated.push({name:'新增检测',responsibleId:tech2.id});
      const staleVersion=local.version;
      local=(await service.executeDispatchAction(manager,id,{action:'edit-repair-items',repairItems:updated,expectedVersion:local.version,requestId:randomUUID()})).task;
      assert.equal(local.items[2].status,'待开工');assert.equal(local.items[2].startAt,undefined);
      const stored=(await pool.query('select name,owner,labor_fee from repair_items where order_id=$1 order by item_no',[id])).rows;
      assert.equal(stored[0].name,'更换机油机滤');assert.equal(stored[0].owner,unique.name);assert.equal(Number(stored[0].labor_fee),123);assert.equal(stored[2].owner,tech2.name);
      await assert.rejects(()=>service.executeDispatchAction(advisor,id,{action:'reassign',reassignItemIds:[2],repairItems:[{id:2,name:'检查刹车',responsibleId:unique.id}],reason:'过期改派',expectedVersion:staleVersion,requestId:randomUUID()}),/任务已更新/);
      const invalid=local.items.map(({id,name,responsibleId})=>({id,name,responsibleId}));invalid[0]={...invalid[0],name:'不应保存',responsibleId:outside.id};
      await assert.rejects(()=>service.executeDispatchAction(advisor,id,{action:'edit-repair-items',repairItems:invalid,expectedVersion:local.version,requestId:randomUUID()}),/有效负责人/);
      assert.equal((await service.dispatchDetail(manager,id)).task.items[0].name,'更换机油机滤');
      assert.equal((await pool.query('select name from repair_items where order_id=$1 and client_item_id=1',[id])).rows[0].name,'更换机油机滤');
    });
    await t.test('project deletion commits rows, audit and owner notifications together, with idempotency and rollback',async()=>{
      const id='delete-repair-project';await seed(id);
      let local=(await service.executeDispatchAction(advisor,id,{action:'assign',expectedVersion:0,requestId:randomUUID(),technicianIds:[tech.id,tech2.id],dueAt,repairItems:[{id:1,name:'取消的维修',responsibleId:tech.id},{id:2,name:'保留的检查',responsibleId:tech2.id}]})).task;
      local=(await service.executeDispatchAction(tech,id,{action:'accept',expectedVersion:local.version,requestId:randomUUID(),partsRequirement:{mode:'none'}})).task;
      await pool.query('update repair_items set labor_fee=321 where order_id=$1 and client_item_id=2',[id]);
      const original=structuredClone(local),kept=local.items[1];
      const request={action:'edit-repair-items',expectedVersion:local.version,requestId:randomUUID(),repairItems:[{id:kept.id,name:kept.name,responsibleId:kept.responsibleId}]};
      const invalid={...request,requestId:randomUUID(),repairItems:[{...request.repairItems[0],responsibleId:outside.id}]};
      await assert.rejects(()=>service.executeDispatchAction(advisor,id,invalid),/有效负责人/);
      assert.equal((await service.dispatchDetail(manager,id)).task.items.length,2);
      assert.equal((await pool.query("select 1 from dispatch_notifications where order_id=$1 and kind='维修项目已删除'",[id])).rowCount,0);
      local=(await service.executeDispatchAction(advisor,id,request)).task;
      await service.executeDispatchAction(advisor,id,request);
      assert.deepEqual(local.items,[kept]);assert.equal(local.stage,original.stage);assert.equal(local.acceptedAt,original.acceptedAt);
      assert.ok(local.participantIds.includes(tech.id));assert.deepEqual(local.technicianIds,[tech2.id]);
      const stored=(await pool.query('select client_item_id,labor_fee from repair_items where order_id=$1',[id])).rows;
      assert.equal(stored.length,1);assert.equal(Number(stored[0].client_item_id),2);assert.equal(Number(stored[0].labor_fee),321);
      const detail=await service.dispatchDetail(manager,id),events=detail.events.filter(e=>e.action==='edit-repair-items');
      assert.equal(events.length,1);assert.equal(events[0].detail.previousItems[0].name,'取消的维修');assert.equal(events[0].detail.items.length,1);
      const notices=(await pool.query("select * from dispatch_notifications where order_id=$1 and kind='维修项目已删除'",[id])).rows;
      assert.equal(notices.length,1);assert.equal(notices[0].recipient_id,tech.id);assert.equal(notices[0].payload.summary,'取消的维修');
      assert.equal(notices[0].payload.actorName,advisor.name);assert.match(notices[0].payload.notice,/无需继续施工/);
      assert.equal((await pool.query('select 1 from dispatch_events where order_id=$1 and request_id=$2',[id,invalid.requestId])).rowCount,0);
      await assert.rejects(()=>service.executeDispatchAction(advisor,id,{...request,requestId:randomUUID(),repairItems:[]}),e=>e.status===400);
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
      const {uploadRepairPhoto,deleteRepairPhoto}=await import('../server/services/repairPhotoService.mjs');
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
      await assert.rejects(()=>deleteRepairPhoto(advisor,'whole',photo.id),e=>e.status===403);
      const extra=await uploadRepairPhoto(tech,'whole',{...photoBody,requestId:randomUUID()},{save});
      await deleteRepairPhoto(tech,'whole',extra.id);
      assert.equal((await pool.query('select id from files where id=$1',[extra.id])).rows.length,0);
      const historic=(await pool.query("select id from files where order_id='whole' and kind='repair_progress_photo' and repair_round=1")).rows[0];
      await assert.rejects(()=>deleteRepairPhoto(tech,'whole',historic.id),e=>e.status===409);
      await execute(tech,'submit-order');assert.equal(whole.inspectorId,undefined);
      await assert.rejects(()=>deleteRepairPhoto(tech,'whole',photo.id),e=>e.status===409);
      await assertFileReadAccess(photo.id,inspector);
      await assert.rejects(()=>uploadRepairPhoto(tech,'whole',{...photoBody,requestId:randomUUID()},{save}),e=>e.status===409);
      await drainInspectionNotifications();
      assert.equal((await pool.query("select count(*) from dispatch_notifications where order_id='whole' and kind='待检验'")).rows[0].count,'3');
      await drainInspectionNotifications();
      assert.equal((await pool.query("select count(*) from dispatch_notifications where order_id='whole' and kind='待检验'")).rows[0].count,'3');
      const command={action:'claim-inspection',expectedVersion:whole.version,requestId:randomUUID()};
      const results=await Promise.allSettled([service.executeDispatchAction(inspector,'whole',command),service.executeDispatchAction(otherInspector,'whole',{...command,requestId:randomUUID()})]);
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      whole=(await service.dispatchDetail(manager,'whole')).task;
      const winner=whole.inspectorId===inspector.id?inspector:otherInspector;
      const stored=(await pool.query("select request_body from dispatch_events where order_id='whole' and action='claim-inspection'")).rows[0].request_body;
      await service.executeDispatchAction(winner,'whole',stored);
      await execute(winner,'inspect',{workHours:undefined});assert.equal(whole.stage,'维修完成');
      assert.equal(whole.workHours,undefined);assert.equal(whole.workHoursRecordedBy,undefined);
      const {assertInspectionCompleted}=await import('../server/repositories/dispatchRepository.mjs');
      await assertInspectionCompleted(pool,'whole');
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
      const env={APP_ENV:'production',DISPATCH_NOTIFICATION_MODE:'dingtalk',DINGTALK_AGENT_ID:'1',DINGTALK_APP_KEY:'test',DINGTALK_APP_SECRET:'test',DISPATCH_APP_URL:'https://example.com'};
      await drainInspectionNotifications({env,sync:async()=>{throw new Error('通讯录同步失败');}});
      assert.equal((await service.dispatchDetail(manager,'no-roster')).task.stage,'待检验');
      assert.match((await service.dispatchDetail(manager,'no-roster')).inspectionNotification.error,/同步失败/);
      await run(advisor,'retry-inspection-notifications');
      // Earlier errored jobs become obsolete before the newest submission resolves.
      await pool.query("update dispatch_inspection_notifications set next_attempt_at=now() where order_id='no-roster'");
      await drainInspectionNotifications({env,sync:async()=>[]});await drainInspectionNotifications({env,sync:async()=>[]});
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
    await t.test('inspection writebacks are atomic, immutable, idempotent and recover after failure',async()=>{
      const id='writeback-case';await seed(id);
      let local=(await service.executeDispatchAction(advisor,id,{action:'assign',expectedVersion:0,requestId:randomUUID(),technicianIds:[tech.id],dueAt})).task;
      const execute=async(actor,action,extra={})=>{const request={action,expectedVersion:local.version,requestId:randomUUID(),...extra};local=(await service.executeDispatchAction(actor,id,request)).task;return request;};
      await execute(tech,'accept',{partsRequirement:{mode:'none'}});await progressPhoto(id);await execute(tech,'submit-order');await execute(inspector,'claim-inspection');
      await execute(inspector,'inspect',{rejectedItemIds:[1],reason:'返工'});
      assert.equal((await pool.query('select count(*) from repair_writebacks where order_id=$1',[id])).rows[0].count,'0');
      await execute(tech,'start',{itemId:1});await execute(tech,'submit-order');await execute(inspector,'claim-inspection');
      await pool.query("update users set legacy_employee_code=null,legacy_employee_name=null,legacy_employee_department=null,legacy_employee_bound_at=null where id=$1",[tech.id]);
      const version=local.version;
      await assert.rejects(()=>execute(inspector,'inspect',{workHours:2}),/绑定润丰/);
      assert.equal((await service.dispatchDetail(manager,id)).task.version,version);
      assert.equal((await pool.query('select count(*) from repair_writebacks where order_id=$1',[id])).rows[0].count,'0');
      await pool.query("update users set legacy_employee_code='027',legacy_employee_name=name,legacy_employee_department='test',legacy_employee_bound_at=now() where id=$1",[tech.id]);
      const inspectRequest=await execute(inspector,'inspect',{workHours:2});await service.executeDispatchAction(inspector,id,inspectRequest);
      let jobs=(await pool.query('select * from repair_writebacks where order_id=$1',[id])).rows;
      assert.equal(jobs.length,1);assert.equal(jobs[0].snapshot.items.length,2);assert.ok(jobs[0].snapshot.items.every(i=>i.employeeCode==='027'));
      assert.equal((await service.dispatchDetail(manager,id)).repairWriteback.repairRound,0);
      const originalSnapshot=JSON.stringify(jobs[0].snapshot);
      await pool.query("update users set legacy_employee_code='099' where id=$1",[tech.id]);
      assert.equal(JSON.stringify((await pool.query('select snapshot from repair_writebacks where order_id=$1',[id])).rows[0].snapshot),originalSnapshot);
      await pool.query("update users set legacy_employee_code='027' where id=$1",[tech.id]);
      // Run only this fixture through the worker. No real SQL Server calls.
      await pool.query("update repair_writebacks set next_attempt_at=now()+interval '1 day' where order_id<>$1 and status='pending'",[id]);
      const {drainRepairWritebacks}=await import('../server/workers/repairWritebackWorker.mjs');
      await drainRepairWritebacks({write:async()=>{throw new Error('must not be called without legacy identifiers');}});
      let job=(await pool.query('select * from repair_writebacks where order_id=$1',[id])).rows[0];assert.equal(job.attempts,0);assert.match(job.error,/等待润丰/);
      await pool.query("update work_orders set dispatch_no='A123',department_code='01',legacy_reid=111,legacy_document_no=222 where id=$1",[id]);
      await pool.query('update repair_writebacks set attempts=4,next_attempt_at=now() where order_id=$1',[id]);
      await drainRepairWritebacks({write:async()=>{throw new Error('模拟断线');}});
      job=(await pool.query('select * from repair_writebacks where order_id=$1',[id])).rows[0];assert.equal(job.status,'failed');assert.equal((await service.dispatchDetail(manager,id)).task.stage,'维修完成');
      const {retryRepairWriteback}=await import('../server/services/repairWritebackService.mjs');
      await assert.rejects(()=>retryRepairWriteback(advisor,id),e=>e.status===403);
      await assert.rejects(()=>retryRepairWriteback(outside,id),e=>e.status===403);
      await retryRepairWriteback(manager,id);
      const previousAllowlist=process.env.RUNFENG_REPAIR_WRITEBACK_DISPATCH_ALLOWLIST;
      process.env.RUNFENG_REPAIR_WRITEBACK_DISPATCH_ALLOWLIST='A67527';
      try{await drainRepairWritebacks({write:async()=>{throw new Error('unallowlisted job must not be processed');}});assert.equal((await pool.query('select status from repair_writebacks where order_id=$1',[id])).rows[0].status,'pending');}
      finally{if(previousAllowlist===undefined)delete process.env.RUNFENG_REPAIR_WRITEBACK_DISPATCH_ALLOWLIST;else process.env.RUNFENG_REPAIR_WRITEBACK_DISPATCH_ALLOWLIST=previousAllowlist;}
      let calls=0;const write=async snapshot=>{calls++;assert.equal(snapshot.documentNo,222);assert.equal(snapshot.items[0].employeeCode,'027');};
      await Promise.all([drainRepairWritebacks({write}),drainRepairWritebacks({write})]);assert.equal(calls,1);
      assert.equal((await pool.query('select status from repair_writebacks where order_id=$1',[id])).rows[0].status,'synced');
      assert.equal(JSON.stringify((await pool.query('select snapshot from repair_writebacks where order_id=$1',[id])).rows[0].snapshot),originalSnapshot);
      // A later repair round replaces the full accumulated list, not just its selected subset.
      await execute(advisor,'reopen-repair',{reworkItemIds:[1],additionalItems:['增修项目'],technicianIds:[tech.id],dueAt,reason:'复修'});
      await execute(tech,'accept',{partsRequirement:{mode:'none'}});await progressPhoto(id,1);await execute(tech,'submit-order');await execute(inspector,'claim-inspection');
      await execute(inspector,'inspect',{rejectedItemIds:[1],reason:'二轮部分退回'});
      assert.equal((await pool.query('select count(*) from repair_writebacks where order_id=$1',[id])).rows[0].count,'1');
      const returned=await service.dispatchDetail(manager,id);assert.equal(returned.task.repairRound,1);assert.equal(returned.task.stage,'维修中');assert.equal(returned.repairWriteback.repairRound,0);
      const passed=structuredClone(local.items.filter(i=>i.status==='已完工'));
      await assert.rejects(()=>execute(tech,'submit-order'),/退回项目尚未开工/);
      await execute(tech,'start-order');assert.deepEqual(local.items.filter(i=>i.status==='已完工'),passed);await execute(tech,'submit-order');await execute(inspector,'claim-inspection');await execute(inspector,'inspect',{workHours:1});
      assert.equal((await service.dispatchDetail(manager,id)).repairWriteback.repairRound,1);
      jobs=(await pool.query('select * from repair_writebacks where order_id=$1 order by id',[id])).rows;
      assert.equal(jobs.length,2);assert.equal(jobs[1].snapshot.items.length,3);assert.ok(jobs[1].snapshot.items.some(i=>i.id===2));
      await pool.query("update repair_writebacks set next_attempt_at=now()+interval '1 day' where order_id=$1 and status='pending'",[id]);
    });
    await t.test('team inspection ownership, review returns and personal photo locks survive database reload',async()=>{
      const id='team-deep-review';await seed(id);
      let current=(await service.dispatchDetail(advisor,id)).task;
      const run=async(actor,action,extra={})=>{current=(await service.executeDispatchAction(actor,id,{action,expectedVersion:current.version,requestId:randomUUID(),...extra})).task;};
      await run(advisor,'assign',{technicianIds:[tech.id,tech2.id],dueAt,repairItems:current.items.map((item,index)=>({...item,responsibleId:index?tech2.id:tech.id}))});
      await run(tech,'accept',{partsRequirement:{mode:'none'}});
      await run(tech2,'record-parts',{partsRequirement:{mode:'none'}});
      await progressPhoto(id);const secondPhoto=await progressPhoto(id);
      await pool.query('update files set uploaded_by=$1 where id=$2',[tech2.id,secondPhoto]);
      await run(tech,'submit-order');
      const {uploadRepairPhoto}=await import('../server/services/repairPhotoService.mjs');
      const upload={requestId:randomUUID(),mimeType:'image/png',imageBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII='};
      const photoCount=(await pool.query('select count(*) from files where order_id=$1',[id])).rows[0].count;
      for(const purpose of ['progress','parts'])await assert.rejects(()=>uploadRepairPhoto(tech,id,{...upload,purpose},{save:async()=>assert.fail('submitted photos must not be saved')}),e=>e.status===409);
      assert.equal((await pool.query('select count(*) from files where order_id=$1',[id])).rows[0].count,photoCount);
      await run(inspector,'claim-inspection');
      const version=current.version,eventCount=(await pool.query('select count(*) from dispatch_events where order_id=$1',[id])).rows[0].count;
      await assert.rejects(()=>run({...inspector,id:'inspector2'},'inspect'),e=>e.status===403);
      assert.equal((await service.dispatchDetail(advisor,id)).task.version,version);
      assert.equal((await pool.query('select count(*) from dispatch_events where order_id=$1',[id])).rows[0].count,eventCount);
      await run(tech2,'submit-order');await run(inspector,'inspect');
      await run(inspector,'send-review');await run(tech,'submit-review');await run(inspector,'claim-inspection');
      await run(inspector,'inspect',{rejectedItemIds:[1],reason:'回审补修'});
      assert.equal(current.stage,'回审');assert.equal(current.items[1].status,'维修中');
      await run(tech2,'submit-review');await run(tech,'start-order');
      assert.equal(current.stage,'回审');await run(tech,'submit-review');await run(inspector,'claim-inspection');await run(inspector,'inspect');
      assert.equal(current.stage,'维修完成');
    });
    await t.test('single-worker submissions preserve claims and reject legacy inspector replacement',async()=>{
      const other={...inspector,id:'inspector2',name:'第二检验员'};
      for(const action of ['submit-order','submit']) {
        const id=`single-claimed-${action}`;await seed(id);
        let current=(await service.dispatchDetail(advisor,id)).task;
        const run=async(actor,action,extra={})=>{current=(await service.executeDispatchAction(actor,id,{action,expectedVersion:current.version,requestId:randomUUID(),...extra})).task;};
        await run(advisor,'assign',{technicianIds:[tech.id],dueAt});await run(tech,'accept',{partsRequirement:{mode:'none'}});await progressPhoto(id);
        await run(tech,'finish',{itemId:1});await run(inspector,'claim-inspection');
        const claim=current.inspectionClaimedAt;
        if(action==='submit') {
          await run(tech,'finish',{itemId:2});
          const version=current.version;
          const events=(await pool.query('select count(*) from dispatch_events where order_id=$1',[id])).rows[0].count;
          await assert.rejects(()=>run(tech,'submit',{inspectorId:other.id}),e=>e.status===409);
          assert.equal((await service.dispatchDetail(advisor,id)).task.version,version);
          assert.equal((await pool.query('select count(*) from dispatch_events where order_id=$1',[id])).rows[0].count,events);
        }
        await run(tech,action,action==='submit'?{inspectorId:inspector.id}:{});
        assert.equal(current.inspectorId,inspector.id);assert.equal(current.inspectionClaimedAt,claim);
        await assert.rejects(()=>run(other,'inspect'),e=>e.status===403);
        await run(inspector,'inspect');assert.equal(current.stage,'维修完成');
      }
    });
    await t.test('new single-worker inspection batches clear all previous claim fields',async()=>{
      const other={...inspector,id:'inspector2',name:'第二检验员'};
      for(const action of ['finish','submit-order']) {
        const id=`single-fresh-${action}`;await seed(id);
        let current=(await service.dispatchDetail(advisor,id)).task;
        const run=async(actor,action,extra={})=>{current=(await service.executeDispatchAction(actor,id,{action,expectedVersion:current.version,requestId:randomUUID(),...extra})).task;};
        await run(advisor,'assign',{technicianIds:[tech.id],dueAt});await run(tech,'accept',{partsRequirement:{mode:'none'}});await progressPhoto(id);
        await run(tech,'finish',{itemId:1});await run(inspector,'claim-inspection');await run(inspector,'inspect');
        await run(tech,action,action==='finish'?{itemId:2}:{});
        const saved=(await service.dispatchDetail(advisor,id)).task;
        for(const key of ['inspectorId','inspectorName','inspectionClaimedAt'])assert.equal(saved[key],undefined,key);
        await run(other,'claim-inspection');await run(other,'inspect');assert.equal(current.stage,'维修完成');
      }
    });
    await t.test('unassigned worker photo removal and reassignment of a paused retained worker persist',async()=>{
      const id='team-deep-reassign';await seed(id);
      let current=(await service.dispatchDetail(advisor,id)).task;
      const run=async(actor,action,extra={})=>{current=(await service.executeDispatchAction(actor,id,{action,expectedVersion:current.version,requestId:randomUUID(),...extra})).task;};
      await run(advisor,'assign',{technicianIds:[tech.id,tech2.id],dueAt});
      await run(tech,'accept',{partsRequirement:{mode:'none'}});
      const photo=await progressPhoto(id);
      const {deleteRepairPhotos}=await import('../server/services/repairPhotoService.mjs');
      await deleteRepairPhotos(tech,id,{fileIds:[photo]});
      assert.equal((await pool.query('select 1 from files where id=$1',[photo])).rowCount,0);
      await run(advisor,'edit-repair-items',{repairItems:current.items.map((item,index)=>({...item,responsibleId:index?tech2.id:tech.id}))});
      await run(tech,'pause',{pauseReason:'技术问题'});
      await run(advisor,'reassign',{technicianIds:[tech.id,unique.id],reason:'调整班组',dueAt,repairItems:current.items.map((item,index)=>({...item,responsibleId:index?unique.id:tech.id}))});
      assert.equal(current.workerPauses?.[tech.id],undefined);
      await run(tech,'accept',{partsRequirement:{mode:'none'}});
      assert.ok(current.acceptedAt);assert.equal(current.stage,'维修中');
    });
    await t.test('project handovers discard departed pauses and preserve the retained worker pause',async()=>{
      for(const route of ['reassign','edit-repair-items']) {
        const id=`pause-handover-${route}`;await seed(id);
        let current=(await service.dispatchDetail(advisor,id)).task;
        const run=async(actor,action,extra={})=>{current=(await service.executeDispatchAction(actor,id,{action,expectedVersion:current.version,requestId:randomUUID(),...extra})).task;};
        await run(advisor,'assign',{technicianIds:[tech.id,tech2.id],dueAt,repairItems:current.items.map((item,index)=>({...item,responsibleId:index?tech2.id:tech.id}))});
        await run(tech,'accept',{partsRequirement:{mode:'none'}});
        await run(tech2,'record-parts',{partsRequirement:{mode:'none'}});
        await run(tech,'pause',{pauseReason:'技术问题'});await run(tech2,'pause',{pauseReason:'待配件'});
        const otherPause=structuredClone(current.workerPauses[tech2.id]);
        const move=async owner=>run(advisor,route,{reason:'项目交接',...(route==='reassign'?{reassignItemIds:[1]}:{}),repairItems:(route==='reassign'?current.items.filter(item=>item.id===1):current.items).map(item=>({id:item.id,name:item.name,responsibleId:item.id===1?owner:item.responsibleId}))});
        await move(unique.id);
        assert.equal(current.workerPauses[tech.id],undefined);assert.deepEqual(current.workerPauses[tech2.id],otherPause);
        await move(tech.id);
        await progressPhoto(id);await run(tech,'submit-order');
        const saved=(await service.dispatchDetail(advisor,id)).task;
        assert.equal(saved.items[0].status,'待检验');assert.deepEqual(saved.workerPauses[tech2.id],otherPause);
        await assert.rejects(()=>run(tech2,'submit-order'),e=>e.status===409);
      }
    });
    await t.test('review after whole-task handover restores historical owners and their notifications',async()=>{
      const id='review-historical-owner';await seed(id);
      let current=(await service.dispatchDetail(advisor,id)).task;
      const run=async(actor,action,extra={})=>{current=(await service.executeDispatchAction(actor,id,{action,expectedVersion:current.version,requestId:randomUUID(),...extra})).task;};
      await run(advisor,'assign',{technicianIds:[tech.id,tech2.id],dueAt,repairItems:current.items.map((item,index)=>({...item,responsibleId:index?tech2.id:tech.id}))});
      await run(tech,'accept',{partsRequirement:{mode:'none'}});await progressPhoto(id);
      await run(tech,'submit-order');await run(inspector,'claim-inspection');await run(inspector,'inspect');
      await run(advisor,'reassign',{technicianIds:[unique.id],dueAt,reason:'整单交班'});
      await run(unique,'accept',{partsRequirement:{mode:'none'}});
      const photo=await progressPhoto(id);await pool.query('update files set uploaded_by=$1 where id=$2',[unique.id,photo]);
      await run(unique,'submit-order');await run(inspector,'claim-inspection');await run(inspector,'inspect');
      assert.deepEqual(current.technicianIds,[unique.id]);
      await run(advisor,'update-technicians',{technicianIds:[unique.id,tech.id,tech2.id]});
      const version=current.version;
      await pool.query('update users set active=false where id=$1',[tech.id]);
      try {
        await assert.rejects(()=>run(inspector,'send-review'),e=>e.status===409);
        assert.equal((await service.dispatchDetail(advisor,id)).task.version,version);
        assert.equal((await service.dispatchDetail(advisor,id)).task.stage,'维修完成');
      } finally {await pool.query('update users set active=true where id=$1',[tech.id]);}
      await run(inspector,'send-review');
      assert.deepEqual(new Set(current.technicianIds),new Set([tech.id,unique.id]));
      await service.dispatchDetail(tech,id);
      const recipients=(await pool.query("select recipient_id from dispatch_notifications where order_id=$1 and kind='维修单回审'",[id])).rows.map(row=>row.recipient_id);
      assert.deepEqual(new Set(recipients),new Set([tech.id,unique.id]));
      assert.ok(current.participantIds.includes(tech2.id));
      await assert.rejects(()=>service.dispatchDetail(tech2,id),e=>e.status===403||e.status===404);
      await run(tech,'submit-review');await run(unique,'submit-review');
      assert.equal(current.stage,'待检验');
      await run(inspector,'claim-inspection');await run(inspector,'inspect');assert.equal(current.stage,'维修完成');
    });
    await t.test('delayed grouped and individual pickup notices expire after issuance or inspection',async()=>{
      const warehouse={id:'warehouse',role:'warehouse',name:'仓管',active:true,shopId:'shop-hq'};
      const {validatePartsPickupNotification:validate}=await import('../server/repositories/partsRequirementRepository.mjs');
      for(const grouped of [false,true]) {
        const id=`pickup-lifecycle-${grouped}`;await seed(id);
        let current=(await service.dispatchDetail(advisor,id)).task;
        const run=async(actor,action,extra={})=>{current=(await service.executeDispatchAction(actor,id,{action,expectedVersion:current.version,requestId:randomUUID(),...extra})).task;};
        await run(advisor,'assign',{technicianIds:[tech.id,tech2.id],dueAt,repairItems:current.items.map((item,index)=>({...item,responsibleId:index?tech2.id:tech.id}))});
        await run(tech,'accept',{partsRequirement:{mode:'list',items:[{name:'滤芯',quantity:1,unit:'个'}]}});
        const items=[{index:0,recipientId:tech.id}];
        await run(warehouse,'confirm-parts',grouped?{preparationGroups:[{partsOwnerId:tech.id,items}]}:{partsOwnerId:tech.id,partsPreparation:items});
        const notice=(await pool.query("select * from dispatch_notifications where order_id=$1 and kind='配件可领取'",[id])).rows[0];
        assert.equal(await validate(notice,tech,pool),true);
        if(grouped) {
          await run(warehouse,'issue-parts',{partsOwnerId:tech.id,partsIssue:[{index:0,recipientId:tech.id}]});
          assert.equal(await validate(notice,tech,pool),false);
        }
        await run(tech2,'record-parts',{partsRequirement:{mode:'none'}});
        await progressPhoto(id);const photo=await progressPhoto(id);await pool.query('update files set uploaded_by=$1 where id=$2',[tech2.id,photo]);
        await run(tech,'submit-order');await run(tech2,'submit-order');
        assert.equal(await validate(notice,tech,pool),false);
        await run(inspector,'claim-inspection');await run(inspector,'inspect');
        assert.equal(await validate(notice,tech,pool),false);
      }
    });
    await t.test('implicit personal issue keeps the prepared recipient in persisted items and notifications',async()=>{
      const id='prepared-recipient-handover';await seed(id);
      const warehouse={id:'warehouse',role:'warehouse',name:'仓管',active:true,shopId:'shop-hq'};
      let current=(await service.dispatchDetail(advisor,id)).task;
      const run=async(actor,action,extra={})=>{current=(await service.executeDispatchAction(actor,id,{action,expectedVersion:current.version,requestId:randomUUID(),...extra})).task;};
      await run(advisor,'assign',{technicianIds:[tech.id,tech2.id],dueAt,repairItems:current.items.map((item,index)=>({...item,responsibleId:index?tech2.id:tech.id}))});
      await run(tech,'accept',{partsRequirement:{mode:'list',items:[{name:'滤芯',quantity:1,unit:'个'}]}});
      await run(warehouse,'confirm-parts',{partsOwnerId:tech.id,partsPreparation:[{index:0,recipientId:tech2.id}]});
      await run(warehouse,'issue-parts',{partsOwnerId:tech.id});
      const saved=(await service.dispatchDetail(advisor,id)).task.partsRequests.find(p=>p.ownerId===tech.id);
      assert.equal(saved.items[0].recipientId,tech2.id);assert.deepEqual(saved.recipientIds,[tech2.id]);assert.ok(saved.issuedAt);
      const recipients=(await pool.query("select recipient_id from dispatch_notifications where order_id=$1 and kind='配件已出库'",[id])).rows.map(row=>row.recipient_id);
      assert.deepEqual(recipients,[tech2.id]);
    });
    await t.test('legacy item completion photos remain editable until personal submission is recorded',async()=>{
      const id='legacy-personal-photo-edit';await seed(id);
      let current=(await service.dispatchDetail(advisor,id)).task;
      const run=async(actor,action,extra={})=>{current=(await service.executeDispatchAction(actor,id,{action,expectedVersion:current.version,requestId:randomUUID(),...extra})).task;};
      await run(advisor,'assign',{technicianIds:[tech.id,tech2.id],dueAt,repairItems:current.items.map((item,index)=>({...item,responsibleId:index?tech2.id:tech.id}))});
      await run(tech,'accept',{partsRequirement:{mode:'none'}});await run(tech2,'record-parts',{partsRequirement:{mode:'none'}});
      // Fixture for pre-personal-submission data created by the historical item finish endpoint.
      current.items[0].status='待检验';current.items[0].finishedBy=tech.id;
      await repo.saveDispatchTask(pool,current);
      const {deleteRepairPhotos}=await import('../server/services/repairPhotoService.mjs');
      const mistaken=await progressPhoto(id);await deleteRepairPhotos(tech,id,{fileIds:[mistaken]});
      assert.equal((await pool.query('select 1 from files where id=$1',[mistaken])).rowCount,0);
      const replacement=await progressPhoto(id);await run(tech,'submit-order');
      await assert.rejects(()=>deleteRepairPhotos(tech,id,{fileIds:[replacement]}),e=>e.status===409);
      assert.equal((await pool.query('select 1 from files where id=$1',[replacement])).rowCount,1);
    });
    await t.test('settlement assignments reopen work and preserve completed items across original and later rounds',async()=>{
      for(const round of [0,1]) {
        const id=`settlement-assignment-${round}`;await seed(id);
        let current=(await service.dispatchDetail(advisor,id)).task;
        const run=async(actor,action,extra={})=>{current=(await service.executeDispatchAction(actor,id,{action,expectedVersion:current.version,requestId:randomUUID(),...extra})).task;};
        await run(advisor,'assign',{technicianIds:[tech.id],dueAt});await run(tech,'accept',{partsRequirement:{mode:'none'}});await progressPhoto(id);
        await run(tech,'submit-order');await run(inspector,'claim-inspection');await run(inspector,'inspect');
        if(round) {
          await run(advisor,'reopen-repair',{technicianIds:[tech.id],dueAt,reason:'返工测试',reworkItemIds:[1,2]});
          await run(tech,'accept',{partsRequirement:{mode:'none'}});await progressPhoto(id,round);
          await run(tech,'submit-order');await run(inspector,'claim-inspection');await run(inspector,'inspect');
        }
        await run(advisor,'update-technicians',{technicianIds:[tech.id,tech2.id]});
        const unchanged=structuredClone(current.items);
        const originalRows=current.items.map(({id,name,responsibleId})=>({id,name,responsibleId}));
        await assert.rejects(()=>run(advisor,'edit-repair-items',{repairItems:[...originalRows.map(row=>({...row,responsibleId:unique.id})),{name:'新增检查',responsibleId:unique.id}],reason:'非法改派'}),e=>e.status===409);
        assert.deepEqual((await service.dispatchDetail(advisor,id)).task.items,unchanged);
        await run(advisor,'edit-repair-items',{repairItems:[...originalRows,{name:'新增检查',responsibleId:unique.id}]});
        assert.equal(current.stage,'维修中');assert.equal(current.orderStatus,'维修中');assert.equal(current.items[2].status,'待开工');assert.deepEqual(current.items.slice(0,2),unchanged);
        assert.equal((await pool.query('select status from work_orders where id=$1',[id])).rows[0].status,'维修中');
        if(round)assert.equal((await pool.query('select closed from dispatch_repair_rounds where order_id=$1 and round_no=1',[id])).rows[0].closed,false);
        const notices=(await pool.query("select recipient_id from dispatch_notifications where order_id=$1 and kind='新增维修项目'",[id])).rows.map(r=>r.recipient_id);
        assert.deepEqual(new Set(notices),new Set([unique.id]));
        await run(unique,'start-order');
        await assert.rejects(()=>run(unique,'submit-order'),e=>e.status===409);
        const photo=await progressPhoto(id,round);await pool.query('update files set uploaded_by=$1 where id=$2',[unique.id,photo]);
        await run(unique,'submit-order');await run(inspector,'claim-inspection');await run(inspector,'inspect');
        assert.equal(current.stage,'维修完成');assert.equal(current.orderStatus,'待结算');
        await run(inspector,'send-review');
        await assert.rejects(()=>run(advisor,'edit-repair-items',{repairItems:current.items.map(item=>({id:item.id,name:item.name,responsibleId:item.id===1?tech2.id:item.responsibleId})),reason:'回审分工'}),e=>e.status===403);
        assert.equal(current.stage,'回审');assert.equal(current.items[0].responsibleId,tech.id);
      }
    });
    if(process.env.DISPATCH_UI_TEST==='true') await t.test('desktop and mobile UI complete assignment, acceptance, repair and inspection',async()=>{
      uiUploadRoot=await fs.mkdtemp(path.join(os.tmpdir(),'repair-dispatch-ui-'));
      process.env.LOCAL_UPLOAD_ROOT=uiUploadRoot;
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
        const editableOrder=await db.createWorkOrder({shop:{id:'shop-hq'},vehicle:{plate:'鲁BEDIT01',vin:'LZWADAGA8NB072733'},customer:{name:'签字前编辑测试'},advisor:advisor.name,repairItems:[{id:1,name:'保养'}]},advisor.name,advisor);
        await pool.query("update work_orders set status='待客户签字' where id=$1",[editableOrder.id]);
        const editPage=await pageFor(advisor,false,'');
        await editPage.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'工作台',exact:true}).click();
        await editPage.getByPlaceholder('搜索车牌 / VIN / 工单号 / 派工号').fill('鲁BEDIT01');
        await editPage.locator('.orders-table tbody tr').filter({hasText:'鲁BEDIT01'}).click();
        await editPage.getByRole('button',{name:'编辑委托单',exact:true}).click();
        await editPage.getByLabel('车牌号码',{exact:true}).fill('鲁B862P7');
        await Promise.all([editPage.waitForResponse(response=>response.request().method()==='PUT'&&response.url().includes('/api/work-orders/')&&response.ok()),editPage.getByRole('button',{name:'保存修改',exact:true}).click()]);
        assert.equal((await db.findWorkOrderById(pool,editableOrder.id)).vehicle.plate,'鲁B862P7');
        assert.equal((await pool.query('select 1 from legacy_sync_outbox where order_id=$1',[editableOrder.id])).rowCount,0);
        await editPage.close();
        async function assertNoDuplicateProjectActions(detail) {
          await detail.getByRole('heading',{name:/维修项目 ·/}).waitFor();
          assert.equal(await detail.getByRole('button',{name:/^改\s*派$/}).count(),0,'项目区域已支持改派，不显示重复底栏按钮');
          assert.equal(await detail.getByRole('button',{name:'调整派工信息',exact:true}).count(),0,'不恢复已移除的底栏入口');
        }
        async function assertActionBarLayout(page) {
          const geometry=await page.locator('.task-detail-actions').evaluate(bar=>{
            const bounds=bar.getBoundingClientRect();
            const buttons=[...bar.querySelectorAll('button')].map(button=>button.getBoundingClientRect()).filter(rect=>rect.width&&rect.height);
            return {
              overlap:buttons.some((a,index)=>buttons.slice(index+1).some(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)),
              overflow:buttons.some(rect=>rect.left<0||rect.right>innerWidth+1),
              reserved:parseFloat(getComputedStyle(document.querySelector('.dispatch-detail')).paddingBottom),height:bounds.height
            };
          });
          assert.equal(geometry.overlap,false);assert.equal(geometry.overflow,false);assert.ok(geometry.reserved>=geometry.height);
        }
        const managerPage=await pageFor(manager);
        await managerPage.locator('.ant-drawer-close').click();
        await managerPage.locator('.ant-drawer-section').waitFor({state:'hidden'});
        const selectStatus=async label=>{await managerPage.getByRole('tab',{name:label,exact:true}).click();};
        await selectStatus('未派工');
        await managerPage.locator('.dispatch-page .ant-table').last().getByText('ui-filter-unassigned',{exact:true}).waitFor();
        await selectStatus('待结算');
        await managerPage.locator('.dispatch-page .ant-table').last().getByText('board-unsettled',{exact:true}).waitFor();
        await selectStatus('草稿');
        const draftRow=managerPage.locator('.dispatch-page .ant-table').last().locator('tr').filter({hasText:'board-draft'});
        await draftRow.getByRole('button',{name:/^详\s*情$/}).click();
        await managerPage.getByText('确认客户签字后才能派工',{exact:true}).waitFor();
        assert.equal(await managerPage.locator('.dispatch-detail').getByRole('button',{name:'指派维修工',exact:true}).count(),0);
        await managerPage.locator('.ant-drawer-close').click();
        await managerPage.locator('.ant-drawer-section').waitFor({state:'hidden'});
        await managerPage.getByRole('button',{name:'重置筛选',exact:true}).click();
        await managerPage.goto(`${base}/?dispatchOrder=ui-order`);
        const managerDrawer=managerPage.locator('.dispatch-detail');
        assert.equal(await managerDrawer.getByRole('button',{name:'指派维修工',exact:true}).count(),0);
        const dialog=managerDrawer;
        await dialog.getByRole('combobox',{name:'执行方式',exact:true}).click();
        await managerPage.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText('外修（员工外派）',{exact:true}).click();
        await dialog.getByLabel('服务单位',{exact:true}).fill('客户车队');
        await dialog.getByLabel('施工地址',{exact:true}).fill('客户停车场');
        await dialog.getByLabel('预计完工时间',{exact:true}).fill('2026-12-31T18:00');
        for(const [index,ownerId] of [[1,'tech'],[2,'tech2']]) {
          await dialog.getByRole('combobox',{name:`维修项目 ${index} 负责人`,exact:true}).click();
          await managerPage.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText(`同名技师（账号 ${ownerId}）`,{exact:true}).click();
          await managerPage.locator('.ant-select-dropdown:visible').waitFor({state:'hidden'});
        }
        await dialog.getByRole('button',{name:'确认派工并通知',exact:true}).click();
        await dialog.locator('.inline-dispatch-form').waitFor({state:'hidden'});
        let ui=(await service.dispatchDetail(manager,'ui-order')).task;
        assert.equal(ui.stage,'待接单');assert.equal(ui.executionMode,'field');assert.equal(ui.technicianIds.length,2);
        const uiTech=people.find(p=>p.id===ui.items[0].responsibleId);
        const workerPage=await pageFor(uiTech,true);
        const drawer=workerPage.locator('.technician-detail');
        await drawer.getByRole('button',{name:'确认接单',exact:true}).click();
        const acceptance=workerPage.getByRole('dialog',{name:'确认接单 · 登记所需配件',exact:true});
        await acceptance.getByText('无需配件',{exact:true}).click();
        await acceptance.getByRole('button',{name:'接单并开始维修',exact:true}).click();
        await acceptance.waitFor({state:'hidden'});
        const {default:sharp}=await import('sharp');
        const photo=await sharp({create:{width:100,height:100,channels:3,background:'#447799'}}).png().toBuffer();
        await drawer.getByLabel('维修记录从相册选择').setInputFiles({name:'维修记录.png',mimeType:'image/png',buffer:photo});
        await drawer.getByText(/已保存/).first().waitFor();
        await drawer.getByRole('button',{name:/^提交(?:本人)?完工$/}).click();
        const workerDialog=workerPage.getByRole('dialog',{name:'确认维修完成？',exact:true});
        assert.equal(await workerDialog.getByRole('combobox',{name:'维修项目 2 负责人',exact:true}).count(),0);
        await workerDialog.getByRole('button',{name:'确认提交',exact:true}).click();
        await workerDialog.waitFor({state:'hidden'});
        ui=(await service.dispatchDetail(manager,'ui-order')).task;assert.equal(ui.stage,'维修中');
        assert.equal(ui.items[1].status,'待开工');
        await managerPage.goto(`${base}/?dispatchOrder=ui-order`);
        await managerDrawer.getByRole('heading',{name:'待检项目 · 1 项',exact:true}).waitFor();
        await managerDrawer.getByLabel('维修项目 2 名称',{exact:true}).waitFor();
        assert.equal(await managerDrawer.getByLabel('维修项目 1 名称',{exact:true}).count(),0);
        await managerPage.screenshot({path:'output/playwright/dispatch-qa/multi-partial-inspection.png',fullPage:true,animations:'disabled'});
        const secondWorker=await pageFor(tech2,true);
        const secondDetail=secondWorker.locator('.technician-detail');
        await secondDetail.getByRole('button',{name:'向仓库申请领料',exact:true}).click();
        const secondParts=secondWorker.getByRole('dialog',{name:'向仓库申请领料',exact:true});
        await secondParts.getByText('无需配件',{exact:true}).click();
        await secondParts.getByRole('button',{name:'发送仓库',exact:true}).click();
        await secondParts.waitFor({state:'hidden'});
        await secondDetail.getByLabel('维修记录从相册选择').setInputFiles({name:'乙维修记录.png',mimeType:'image/png',buffer:photo});
        await secondDetail.getByText(/已保存/).first().waitFor();
        await secondDetail.getByRole('button',{name:/^提交(?:本人)?完工$/}).click();
        const secondSubmit=secondWorker.getByRole('dialog',{name:'确认维修完成？',exact:true});
        await secondSubmit.getByRole('button',{name:'确认提交',exact:true}).click();await secondSubmit.waitFor({state:'hidden'});
        ui=(await service.dispatchDetail(manager,'ui-order')).task;assert.equal(ui.stage,'待检验');
        const inspectorPage=await pageFor(inspector,true);
        const inspection=inspectorPage.locator('.dispatch-detail');
        await inspection.getByRole('button',{name:'开始检验',exact:true}).click();
        const secondInspectorPage=await pageFor({...inspector,id:'inspector2'},true);
        await secondInspectorPage.locator('.dispatch-detail').getByRole('heading',{name:'待检项目 · 2 项',exact:true}).waitFor();
        assert.equal(await secondInspectorPage.getByRole('button',{name:/提交检验结果/}).count(),0);
        assert.equal(await secondInspectorPage.getByLabel('检验结果：项目1',{exact:true}).getByRole('radio',{name:'通过',exact:true}).isDisabled(),true);
        for(const itemId of [1,2])await inspection.getByLabel(`检验结果：项目${itemId}`,{exact:true}).getByText('通过',{exact:true}).click();
        await inspection.getByRole('button',{name:/提交检验结果/}).click();
        const inspectionDialog=inspectorPage.getByRole('dialog',{name:'提交检验结果',exact:true});
        await inspectionDialog.getByRole('button',{name:'确认提交检验结果',exact:true}).click();
        await inspectionDialog.waitFor({state:'hidden'});
        assert.equal((await service.dispatchDetail(manager,'ui-order')).task.stage,'维修完成');
        await fs.mkdir('output/playwright/dispatch-qa',{recursive:true});
        await workerPage.screenshot({path:'output/playwright/dispatch-qa/mobile.png'});
        await managerPage.locator('.ant-drawer-close').click();
        await managerPage.locator('.ant-drawer-section').waitFor({state:'hidden'});
        await managerPage.screenshot({path:'output/playwright/dispatch-qa/desktop.png',fullPage:true});
        assert.equal(await workerPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'mobile page has no horizontal overflow');
        // A partial return must remain in review, with a usable start/re-submit action.
        let reviewTask=(await service.dispatchDetail(manager,'ui-order')).task;
        await service.executeDispatchAction(inspector,'ui-order',{action:'send-review',expectedVersion:reviewTask.version,requestId:randomUUID()});
        async function submitReview(page) {
          await page.locator('.technician-detail').getByRole('button',{name:'提交回审',exact:true}).click();
          const dialog=page.getByRole('dialog',{name:'确认提交回审？',exact:true});
          await dialog.getByRole('button',{name:'提交回审',exact:true}).click();await dialog.waitFor({state:'hidden'});
        }
        await workerPage.reload();await submitReview(workerPage);
        await inspectorPage.reload();await inspection.getByRole('button',{name:'开始检验',exact:true}).click();
        await inspection.getByLabel('检验结果：项目1',{exact:true}).getByText('退回',{exact:true}).click();
        await inspection.getByRole('button',{name:/提交检验结果/}).click();
        const reviewInspection=inspectorPage.getByRole('dialog',{name:'提交检验结果',exact:true});
        await reviewInspection.getByRole('textbox',{name:'备注',exact:true}).fill('回审部分项目补修');
        await reviewInspection.getByRole('button',{name:'确认提交检验结果',exact:true}).click();await reviewInspection.waitFor({state:'hidden'});
        assert.equal((await service.dispatchDetail(manager,'ui-order')).task.stage,'回审');
        await workerPage.reload();await drawer.getByRole('button',{name:'开始返工',exact:true}).click();
        await submitReview(workerPage);
        await secondWorker.reload();await submitReview(secondWorker);
        await inspectorPage.reload();await inspection.getByRole('button',{name:'开始检验',exact:true}).click();
        for(const itemId of [1,2])await inspection.getByLabel(`检验结果：项目${itemId}`,{exact:true}).getByText('通过',{exact:true}).click();
        await inspection.getByRole('button',{name:/提交检验结果/}).click();
        await inspectionDialog.getByRole('button',{name:'确认提交检验结果',exact:true}).click();await inspectionDialog.waitFor({state:'hidden'});
        assert.equal((await service.dispatchDetail(manager,'ui-order')).task.stage,'维修完成');
        // Desktop settlement reassignment and mobile review scheduling use the same project editor.
        {
          const id='ui-settlement-reassign';await seed(id);
          let current=(await service.dispatchDetail(advisor,id)).task;
          const run=async(actor,action,extra={})=>{current=(await service.executeDispatchAction(actor,id,{action,expectedVersion:current.version,requestId:randomUUID(),...extra})).task;};
          await run(advisor,'assign',{technicianIds:[tech.id],dueAt});await run(tech,'accept',{partsRequirement:{mode:'none'}});await progressPhoto(id);
          await run(tech,'submit-order');await run(inspector,'claim-inspection');await run(inspector,'inspect');
          const untouched=structuredClone(current.items);
          const page=await pageFor(advisor,false,id),detail=page.locator('.dispatch-detail');
          await detail.getByRole('checkbox',{name:'选取维修项目 1',exact:true}).waitFor();
          assert.equal(await detail.getByRole('checkbox',{name:'选取维修项目 1',exact:true}).isDisabled(),true);
          assert.equal(await detail.getByRole('combobox',{name:'维修项目 1 负责人',exact:true}).count(),0);
          assert.equal(await detail.getByLabel('维修项目 1 名称',{exact:true}).count(),0);
          assert.equal(await detail.getByRole('button',{name:'删除维修项目 1',exact:true}).count(),0);
          await detail.getByRole('button',{name:'＋ 新增增修项目',exact:true}).click();
          await detail.getByLabel('维修项目 3 名称',{exact:true}).fill('结算前新增检查');
          await detail.getByRole('combobox',{name:'维修项目 3 负责人',exact:true}).click();
          await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText('唯一技师',{exact:true}).click();
          assert.equal(await detail.getByLabel('原因或交接说明',{exact:true}).count(),0);
          await detail.getByRole('button',{name:'新增并分配任务',exact:true}).click();
          await detail.getByText('新增任务后退回正在维修',{exact:true}).waitFor({state:'hidden'});
          current=(await service.dispatchDetail(advisor,id)).task;
          assert.equal(current.orderStatus,'维修中');assert.equal(current.stage,'维修中');assert.deepEqual(current.items.slice(0,2),untouched);
          await run(unique,'start-order');const imageId=await progressPhoto(id);await pool.query('update files set uploaded_by=$1 where id=$2',[unique.id,imageId]);
          await run(unique,'submit-order');await run(inspector,'claim-inspection');await run(inspector,'inspect');await run(inspector,'send-review');
          const mobile=await pageFor(advisor,true,id),review=mobile.locator('.dispatch-detail');
          await review.getByRole('heading',{name:/维修项目 ·/}).waitFor();
          assert.equal(await review.locator('.repair-items-editor').count(),0);
          assert.equal(await review.getByRole('button',{name:'＋ 新增增修项目',exact:true}).count(),0);
          assert.equal(await review.getByRole('combobox',{name:'维修项目 1 负责人',exact:true}).count(),0);
          current=(await service.dispatchDetail(advisor,id)).task;
          assert.equal(current.stage,'回审');assert.equal(current.items[0].responsibleId,tech.id);
          assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        }
        // A legacy team reduced to one worker must still show and enforce that worker's pause.
        {
          const id='ui-single-personal-pause';await seed(id);
          let current=(await service.dispatchDetail(advisor,id)).task;
          const run=async(actor,action,extra={})=>{current=(await service.executeDispatchAction(actor,id,{action,expectedVersion:current.version,requestId:randomUUID(),...extra})).task;};
          await run(advisor,'assign',{technicianIds:[tech.id,tech2.id],dueAt,repairItems:current.items.map((item,index)=>({...item,responsibleId:index?tech2.id:tech.id}))});
          await run(tech,'accept',{partsRequirement:{mode:'none'}});
          await run(tech2,'record-parts',{partsRequirement:{mode:'none'}});
          await run(tech2,'pause',{pauseReason:'技术问题'});
          // Older shared-material tasks do not have personal material requests.
          delete current.partsRequests;current.partsRequirement={mode:'none',items:[],photoIds:[]};
          await repo.saveDispatchTask(pool,current);
          await run(advisor,'reassign',{reason:'合并项目',reassignItemIds:[1],repairItems:[{id:1,name:current.items[0].name,responsibleId:tech2.id}]});
          const photo=await progressPhoto(id);await pool.query('update files set uploaded_by=$1 where id=$2',[tech2.id,photo]);
          await assert.rejects(()=>run(tech2,'submit-order'),e=>e.status===409);
          const page=await pageFor(tech2,true,id);
          const resume=page.getByRole('button',{name:'继续维修',exact:true});
          await resume.click();await resume.waitFor({state:'hidden'});
          await page.getByRole('button',{name:'提交完工',exact:true}).waitFor();
          current=(await service.dispatchDetail(advisor,id)).task;
          assert.equal(current.workerPauses?.[tech2.id],undefined);
          await run(tech2,'submit-order');assert.equal(current.stage,'待检验');
        }
        // Historical external contractors have no employee login; the advisor must be able to resubmit review.
        {
          const id='ui-legacy-contractor-review';await seed(id);
          let current=(await service.dispatchDetail(advisor,id)).task;
          Object.assign(current,{executionMode:'outsourced',contractor:'历史承包方',outsourcingMode:'offsite',stage:'待检验',technicianIds:[],technicianId:undefined,acceptedAt:new Date().toISOString()});
          current.items.forEach(item=>{item.status='待检验';delete item.responsibleId;});
          await repo.saveDispatchTask(pool,current);await progressPhoto(id);
          await service.executeDispatchAction(inspector,id,{action:'send-review',expectedVersion:current.version,requestId:randomUUID()});
          const page=await pageFor(advisor,true,id);
          const form=page.locator('.dispatch-detail');
          await form.getByRole('button',{name:'提交回审',exact:true}).click();
          const modal=page.getByRole('dialog',{name:'提交回审',exact:true});
          await modal.getByRole('button',{name:/^确\s*认$/}).click();await modal.waitFor({state:'hidden'});
          current=(await service.dispatchDetail(advisor,id)).task;
          assert.equal(current.stage,'待检验');assert.ok(current.items.every(item=>item.finishedBy===advisor.id));
          await assertActionBarLayout(page);
        }
        for(const outsourcingMode of ['onsite','offsite']) {
          const id=`ui-outsourced-${outsourcingMode}`;await seed(id);
          const page=await pageFor(advisor,true,id);
          const form=page.locator('.dispatch-detail');
          await form.getByRole('combobox',{name:'执行方式',exact:true}).click();
          await page.locator('.ant-select-item-option-content').filter({hasText:/^外包$/}).click();
          if(outsourcingMode==='offsite') {
            await form.getByRole('combobox',{name:'外包施工方式',exact:true}).click();
            await page.locator('.ant-select-item-option-content').filter({hasText:'车辆外送整包维修'}).click();
            await form.getByLabel('交车时间',{exact:true}).fill('2026-09-14T10:00');
            await form.getByLabel('收车时间',{exact:true}).fill('2026-09-15T10:00');
          }
          await form.getByRole('combobox',{name:'承包方',exact:true}).click();
          await page.getByText('测试外包单位',{exact:true}).last().click();
          await form.getByLabel('约定费用',{exact:true}).fill('500');
          await form.getByLabel('预计完工时间',{exact:true}).fill('2026-12-31T18:00');
          await page.screenshot({path:`output/playwright/dispatch-qa/${outsourcingMode}-form-mobile.png`});
          await form.getByRole('button',{name:'确认派工并通知',exact:true}).click();await form.locator('.inline-dispatch-form').waitFor({state:'hidden'});
          const task=(await service.dispatchDetail(advisor,id)).task;
          assert.equal(task.executionMode,'outsourced');assert.equal(task.outsourcingMode,outsourcingMode);assert.equal(task.agreedFee,500);
          assert.equal(await page.locator('.dispatch-detail').getByRole('button',{name:/^改\s*派$/}).count(),0);
          await page.locator('.dispatch-detail').getByRole('button',{name:'确认接单',exact:true}).click();
          const acceptForm=page.getByRole('dialog',{name:'确认接单 · 登记所需配件',exact:true});
          await acceptForm.getByText('无需配件',{exact:true}).click();
          await acceptForm.getByRole('button',{name:'接单并开始维修',exact:true}).click();
          await acceptForm.waitFor({state:'hidden'});
          assert.equal((await service.dispatchDetail(advisor,id)).task.stage,'维修中');
          // Outsourced progress must remain available inside the project editor.
          await form.getByRole('button',{name:'＋ 新增增修项目',exact:true}).click();
          await form.getByLabel('维修项目 3 名称',{exact:true}).fill('外包增项');
          await form.getByRole('button',{name:'保存维修项目',exact:true}).click();
          await form.getByRole('button',{name:'开工：外包增项',exact:true}).click();
          await form.getByRole('button',{name:'项目完成：外包增项',exact:true}).waitFor();
          for(const name of ['项目1','项目2','外包增项']) {
            const finish=form.getByRole('button',{name:`项目完成：${name}`,exact:true});
            await finish.click();await finish.waitFor({state:'hidden'});
            if(name==='项目1') {
              await form.getByRole('heading',{name:'待检项目 · 1 项',exact:true}).waitFor();
              await form.getByRole('button',{name:'项目完成：项目2',exact:true}).waitFor();
            }
          }
          await form.getByLabel('维修记录从相册选择').setInputFiles({name:'外包维修记录.png',mimeType:'image/png',buffer:photo});
          await form.getByText(/已保存/).first().waitFor();
          await form.getByRole('button',{name:'提报检验',exact:true}).click();
          const submit=page.getByRole('dialog',{name:'提报检验',exact:true});
          await submit.getByRole('combobox',{name:'指定检验员',exact:true}).click();
          await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText(inspector.name,{exact:true}).click();
          await submit.getByRole('button',{name:/^确\s*认$/}).click();await submit.waitFor({state:'hidden'});
          assert.equal((await service.dispatchDetail(advisor,id)).task.stage,'待检验');
          await page.screenshot({path:`output/playwright/dispatch-qa/${outsourcingMode}-mobile.png`});
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        }
        // Reopen a completed order and exercise a rejected inspection through the UI.
        await managerPage.goto(`${base}/?dispatchOrder=ui-order`);
        await managerPage.locator('.dispatch-detail').getByRole('button',{name:'发起返工',exact:true}).click();
        const rework=managerPage.getByRole('dialog',{name:'发起返工',exact:true});
        await rework.getByText('项目1',{exact:true}).click();
        await rework.getByRole('combobox',{name:'维修工',exact:true}).click();
        await managerPage.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText(/^同名技师（账号 tech2） · 当前/).click();
        await rework.getByRole('combobox',{name:'维修工',exact:true}).press('Escape');
        await rework.getByLabel('预计完工时间',{exact:true}).fill('2026-12-31T18:00');
        await rework.getByLabel('原因或交接说明',{exact:true}).fill('浏览器返工验收');
        await rework.getByRole('button',{name:/^确\s*认$/}).click();await rework.waitFor({state:'hidden'});
        await workerPage.goto(`${base}/?dispatchOrder=ui-order`);
        await drawer.getByRole('button',{name:'确认接单',exact:true}).click();
        const again=workerPage.getByRole('dialog',{name:'确认接单 · 登记所需配件',exact:true});
        await again.getByText('无需配件',{exact:true}).click();await again.getByRole('button',{name:'接单并开始维修',exact:true}).click();await again.waitFor({state:'hidden'});
        await drawer.getByLabel('维修记录从相册选择').setInputFiles({name:'返工记录.png',mimeType:'image/png',buffer:photo});
        async function submitRework() {
          await drawer.getByRole('button',{name:/^提交(?:本人)?完工$/}).click();
          const form=workerPage.getByRole('dialog',{name:'确认维修完成？',exact:true});
          const owner=form.getByRole('combobox',{name:'维修项目 1 负责人',exact:true});
          await owner.click();await owner.press('ArrowDown');await owner.press('Enter');
          if(await form.getByLabel('原因或交接说明',{exact:true}).count())await form.getByLabel('原因或交接说明',{exact:true}).fill('返工责任确认');
          await form.getByRole('button',{name:'确认提交',exact:true}).click();await form.waitFor({state:'hidden'});
        }
        await submitRework();
        async function inspectRework(result) {
          await inspectorPage.goto(`${base}/?dispatchOrder=ui-order`);
          await inspection.getByRole('button',{name:'开始检验',exact:true}).click();
          await inspection.getByLabel('检验结果：项目1',{exact:true}).getByText(result,{exact:true}).click();
          await inspection.getByRole('button',{name:/提交检验结果/}).click();
          const form=inspectorPage.getByRole('dialog',{name:'提交检验结果',exact:true});
          if(result==='退回')await form.getByRole('textbox',{name:'备注',exact:true}).fill('需要复查');
          await form.getByRole('button',{name:'确认提交检验结果',exact:true}).click();await form.waitFor({state:'hidden'});
        }
        await inspectRework('退回');
        await workerPage.goto(`${base}/?dispatchOrder=ui-order`);
        await drawer.getByRole('button',{name:'开始返工',exact:true}).click();
        await submitRework();await inspectRework('通过');
        const repaired=(await service.dispatchDetail(manager,'ui-order')).task;
        assert.equal(repaired.stage,'维修完成');assert.equal(repaired.repairRound,1);assert.equal(repaired.reworkCount,1);
        await inspectorPage.screenshot({path:'output/playwright/dispatch-qa/mobile-rework-inspection.png',fullPage:true});

        // Material requests must remain unstarted until a warehouse handover.
        await seed('ui-parts');
        await service.executeDispatchAction(advisor,'ui-parts',{action:'assign',expectedVersion:0,requestId:randomUUID(),technicianIds:[tech.id],dueAt});
        const partsWorker=await pageFor(tech,true,'ui-parts');
        await partsWorker.locator('.technician-detail').getByRole('button',{name:'确认接单',exact:true}).click();
        const partsForm=partsWorker.getByRole('dialog',{name:'确认接单 · 登记所需配件',exact:true});
        await partsForm.getByText('填写配件',{exact:true}).click();
        await partsForm.getByText('机油',{exact:true}).click();
        await partsForm.getByRole('button',{name:'接单并提交配件需求',exact:true}).click();await partsForm.waitFor({state:'hidden'});
        assert.equal((await service.dispatchDetail(manager,'ui-parts')).task.stage,'待开工');
        const warehousePage=await pageFor({id:'warehouse',role:'warehouse',shopId:'shop-hq',active:true},true,'ui-parts');
        await warehousePage.getByRole('button',{name:'确认备料',exact:true}).click();
        const preparation=warehousePage.getByRole('dialog',{name:'确认备料',exact:true});
        await preparation.getByRole('checkbox',{name:'全选待备料配件（1 项）',exact:true}).check();
        await preparation.getByRole('button',{name:'备料完成并通知（1 项）',exact:true}).click();
        await preparation.waitFor({state:'hidden'});
        const prepared=(await service.dispatchDetail(manager,'ui-parts')).task;
        assert.equal(prepared.stage,'维修中');assert.ok(prepared.partsRequirement.preparedAt);
        assert.equal(prepared.partsRequirement.items[0].recipientId,tech.id);
        await warehousePage.screenshot({path:'output/playwright/dispatch-qa/mobile-warehouse-prepared.png',fullPage:true,animations:'disabled'});
        assert.equal(await warehousePage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        for(const mobile of [false,true]) {
          const id=`ui-inline-${mobile?'mobile':'desktop'}`;await seed(id);
          const page=await pageFor(manager,mobile,id),detail=page.locator('.dispatch-detail');
          await detail.getByLabel('维修项目 1 名称',{exact:true}).fill('批量派工项目1');
          await detail.getByRole('button',{name:'仅保存项目',exact:true}).click();
          await page.waitForFunction(()=>[...document.querySelectorAll('.inline-dispatch-actions button')].some(button=>button.textContent==='仅保存项目'&&button.disabled));
          assert.equal((await service.dispatchDetail(manager,id)).task.stage,'待派工');
          await detail.getByRole('checkbox',{name:'全选可分配项目',exact:true}).check();
          await detail.getByRole('combobox',{name:'维修项目 1 负责人',exact:true}).click();
          await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText('同名技师（账号 tech）',{exact:true}).click();
          await page.locator('.ant-select-dropdown:visible').waitFor({state:'hidden'});
          assert.match(await detail.locator('.repair-item-row').nth(1).innerText(),/同名技师（账号 tech）/);
          await detail.getByRole('checkbox',{name:'全选可分配项目',exact:true}).uncheck();
          await detail.getByRole('combobox',{name:'维修项目 2 负责人',exact:true}).click();
          await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText('同名技师（账号 tech2）',{exact:true}).click();
          await page.locator('.ant-select-dropdown:visible').waitFor({state:'hidden'});
          await detail.getByLabel('预计完工时间',{exact:true}).fill('2026-12-31T18:00');
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
          await page.screenshot({path:`output/playwright/dispatch-qa/inline-assign-${mobile?'mobile':'desktop'}.png`});
          await detail.getByRole('button',{name:'确认派工并通知',exact:true}).click();
          await detail.locator('.inline-dispatch-form').waitFor({state:'hidden'});
          const assigned=(await service.dispatchDetail(manager,id)).task;
          assert.equal(assigned.stage,'待接单');assert.equal(assigned.items[0].name,'批量派工项目1');
          assert.equal(assigned.items[0].responsibleId,tech.id);assert.equal(assigned.items[1].responsibleId,tech2.id);
          assert.equal((await pool.query("select 1 from dispatch_notifications where order_id=$1 and kind<>'需确认用户签字'",[id])).rowCount,2);
        }
        for(const mobile of [false,true]) {
          const id=`ui-projects-${mobile?'mobile':'desktop'}`;await seed(id);
          let projectTask=(await service.executeDispatchAction(advisor,id,{action:'assign',expectedVersion:0,requestId:randomUUID(),technicianIds:[tech.id,tech2.id],dueAt,repairItems:[{id:1,name:'项目1',responsibleId:tech.id},{id:2,name:'项目2',responsibleId:tech2.id}]})).task;
          projectTask=(await service.executeDispatchAction(tech,id,{action:'accept',expectedVersion:projectTask.version,requestId:randomUUID(),partsRequirement:{mode:'none'}})).task;
          const unchanged=structuredClone(projectTask.items[1]),acceptedAt=projectTask.acceptedAt;
          const page=await pageFor(manager,mobile,id),detail=page.locator('.dispatch-detail');
          await assertNoDuplicateProjectActions(detail);
          await detail.getByLabel('维修项目 1 名称',{exact:true}).fill('修改项目1');
          await detail.getByRole('combobox',{name:'维修项目 1 负责人',exact:true}).click();
          await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText('唯一技师',{exact:true}).click();
          await page.locator('.ant-select-dropdown:visible').waitFor({state:'hidden'});
          await detail.getByRole('button',{name:'＋ 新增增修项目',exact:true}).click();
          await detail.getByLabel('维修项目 3 名称',{exact:true}).fill('新增检测');
          await detail.getByRole('combobox',{name:'维修项目 3 负责人',exact:true}).click();
          await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText('同名技师（账号 tech2）',{exact:true}).click();
          await page.locator('.ant-select-dropdown:visible').waitFor({state:'hidden'});
          assert.equal(await detail.locator('.task-projects .repair-items-save').count(),0);
          await detail.locator('.task-detail-actions').getByRole('button',{name:'保存维修项目',exact:true}).waitFor();
          await detail.getByRole('button',{name:'保存维修项目',exact:true}).click();
          await detail.getByText('请填写原因或交接说明',{exact:true}).waitFor();
          assert.equal((await service.dispatchDetail(manager,id)).task.items[0].responsibleId,tech.id);
          await detail.getByLabel('原因或交接说明',{exact:true}).fill('测试项目交接');
          await detail.getByRole('button',{name:'保存维修项目',exact:true}).click();
          await detail.locator('.task-detail-actions .repair-items-save button').first().waitFor({state:'hidden'});
          projectTask=(await service.dispatchDetail(manager,id)).task;
          assert.equal(projectTask.items[0].name,'修改项目1');assert.equal(projectTask.items[0].responsibleId,unique.id);assert.deepEqual(projectTask.items[1],unchanged);
          assert.equal(projectTask.items[2].name,'新增检测');assert.equal(projectTask.items[2].status,'待开工');assert.equal(projectTask.items[2].responsibleId,tech2.id);
          assert.equal(await detail.getByRole('button',{name:/^改\s*派$/}).count(),0);
          await detail.getByRole('checkbox',{name:'选取维修项目 1',exact:true}).check();
          await detail.getByRole('checkbox',{name:'选取维修项目 3',exact:true}).check();
          await detail.getByRole('combobox',{name:'维修项目 1 负责人',exact:true}).click();
          await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText('唯一技师',{exact:true}).click();
          await page.locator('.ant-select-dropdown:visible').waitFor({state:'hidden'});
          assert.match(await detail.locator('.repair-item-row').nth(2).innerText(),/唯一技师/);
          await detail.getByRole('combobox',{name:'维修项目 1 负责人',exact:true}).click();
          await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText('同名技师（账号 tech）',{exact:true}).click();
          await page.locator('.ant-select-dropdown:visible').waitFor({state:'hidden'});
          await detail.getByRole('heading',{name:/维修项目 ·/}).scrollIntoViewIfNeeded();
          await assertNoDuplicateProjectActions(detail);
          await assertActionBarLayout(page);
          await page.screenshot({path:`output/playwright/dispatch-qa/projects-reassign-${mobile?'mobile':'desktop'}.png`});
          assert.equal(await detail.locator('.task-projects .repair-items-save').count(),0);
          await detail.locator('.task-detail-actions').getByRole('button',{name:'保存维修项目',exact:true}).waitFor();
          if(await detail.getByLabel('原因或交接说明',{exact:true}).count())await detail.getByLabel('原因或交接说明',{exact:true}).fill('测试项目交接');
          await detail.getByRole('button',{name:'保存维修项目',exact:true}).click();
          await detail.locator('.task-detail-actions .repair-items-save button').first().waitFor({state:'hidden'});
          const reassigned=(await service.dispatchDetail(manager,id)).task;
          assert.equal(reassigned.items[0].responsibleId,tech.id);assert.equal(reassigned.items[2].responsibleId,tech.id);assert.deepEqual(reassigned.items[1],unchanged);assert.equal(reassigned.acceptedAt,acceptedAt);assert.equal(reassigned.stage,'维修中');
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
          await page.screenshot({path:`output/playwright/dispatch-qa/projects-edit-${mobile?'mobile':'desktop'}.png`});
          const beforeDelete=(await pool.query("select count(*)::int as n from dispatch_notifications where order_id=$1 and kind='维修项目已删除'",[id])).rows[0].n;
          await detail.getByRole('button',{name:'删除维修项目 1',exact:true}).click();
          assert.equal(await detail.locator('.repair-item-row').count(),2);
          assert.equal((await service.dispatchDetail(manager,id)).task.items.length,3);
          await detail.getByRole('button',{name:'取消修改',exact:true}).click();
          assert.equal(await detail.locator('.repair-item-row').count(),3);
          assert.equal((await pool.query("select count(*)::int as n from dispatch_notifications where order_id=$1 and kind='维修项目已删除'",[id])).rows[0].n,beforeDelete);
          await detail.getByRole('button',{name:'删除维修项目 1',exact:true}).click();
          if(await detail.getByLabel('原因或交接说明',{exact:true}).count())await detail.getByLabel('原因或交接说明',{exact:true}).fill('测试项目交接');
          await detail.getByRole('button',{name:'保存维修项目',exact:true}).click();
          await detail.locator('.task-detail-actions .repair-items-save button').first().waitFor({state:'hidden'});
          const afterDelete=await service.dispatchDetail(manager,id);
          assert.equal(afterDelete.task.items.length,2);assert.equal(afterDelete.task.items.some(i=>i.id===reassigned.items[0].id),false);
          assert.deepEqual(afterDelete.task.items[0],unchanged);
          assert.equal((await pool.query("select count(*)::int as n from dispatch_notifications where order_id=$1 and kind='维修项目已删除'",[id])).rows[0].n,beforeDelete+1);
          await detail.getByRole('heading',{name:/维修项目 ·/}).scrollIntoViewIfNeeded();
          await page.screenshot({path:`output/playwright/dispatch-qa/projects-delete-${mobile?'mobile':'desktop'}.png`});
          await assertNoDuplicateProjectActions(detail);
          await assertActionBarLayout(page);
          await page.reload();
          await assertNoDuplicateProjectActions(detail);

        }
        assert.deepEqual(browserErrors,[]);
      } catch(e) {for(const page of pages){console.log('UI state:',await page.locator('body').innerText());console.log('Buttons:',await page.locator('.dispatch-detail button').evaluateAll(nodes=>nodes.map(n=>({html:n.outerHTML,hiddenAncestor:n.closest('[aria-hidden=true]')?.className}))));await fs.mkdir('output/playwright/dispatch-qa',{recursive:true});await page.screenshot({path:'output/playwright/dispatch-qa/failure.png',fullPage:true});}console.log('Browser errors:',browserErrors);throw e;} finally {await browser.close();}
    });
  } finally {
    if(server) await new Promise(resolve=>server.close(resolve));
    await Promise.allSettled([...inFlight]);
    if(pool) await pool.end();
    await Promise.all(connectionsClosed);
    if(uiUploadRoot)await fs.rm(uiUploadRoot,{recursive:true,force:true});
    if(/^codex_dispatch_test_\d+_\d+$/.test(name)) await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.end();
  }
});
