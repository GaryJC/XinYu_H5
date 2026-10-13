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
    const repo=await import('../server/repositories/dispatchRepository.mjs');
    const notifications=await import('../server/repositories/dispatchNotificationRepository.mjs');
    const worker=await import('../server/workers/dispatchNotifications.mjs');
    const {transitionWorkOrder,syncWorkOrderToPlatform}=await import('../server/db.mjs');
    const {assertFileReadAccess}=await import('../server/repositories/fileRepository.mjs');
    let task;
    const body=(action,extra={})=>({action,expectedVersion:task?.version||0,requestId:randomUUID(),...extra});
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
      await action(tech,'accept');await action(tech,'start',{itemId:1});
      const start=task.items[0].startAt;
      await action(tech,'pause',{pauseReason:'待配件'});assert.equal(task.stage,'暂停');
      await action(dispatcher,'reassign',{technicianId:tech2.id,dueAt,reason:'交接维修项目'});
      await assert.rejects(()=>service.dispatchDetail(tech,'new'),e=>e.status===403);
      await action(tech2,'accept');assert.equal(task.items[0].startAt,start);assert.equal(task.items[0].startedBy,'tech');
      await action(tech2,'finish',{itemId:1});await action(tech2,'start',{itemId:2});await action(tech2,'finish',{itemId:2});
      assert.equal(task.orderStatus,'维修中');
    });
    await t.test('inspection partial rejection, completion totals and settlement remain distinct',async()=>{
      await action(tech2,'submit',{inspectorId:'inspector'});
      assert.equal((await service.technicianSummaries(manager)).find(p=>p.id==='tech2').inspection,1);
      await action(inspector,'inspect',{rejectedItemIds:[1],reason:'制动重做'});
      assert.equal(task.items[1].status,'已完工');
      await action(tech2,'start',{itemId:1});await action(tech2,'finish',{itemId:1});await action(tech2,'submit',{inspectorId:'inspector'});
      await action(manager,'inspect',{rejectedItemIds:[]});assert.equal(task.orderStatus,'待结算');
      assert.equal((await service.technicianSummaries(manager)).find(p=>p.id==='tech2').completed,1);
      await assert.rejects(()=>transitionWorkOrder('new','完成',manager.name,'结算'),e=>e.status===409);
      await assert.rejects(()=>action(tech2,'record-hours',{workHours:2}),e=>e.status===403);
      await action(dispatcher,'record-hours',{workHours:2.5});
      assert.equal(task.workHours,2.5);assert.equal(task.workHoursRecordedBy,dispatcher.id);
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

      await pool.query("update users set active=false where id='manager'");
      assert.equal((await call('/api/dispatch/tasks')).status,401);
      await pool.query("update users set active=true where id='manager'");
    });
    await t.test('platform sync does not reset a dispatched repair item',async()=>{
      await seed('platform');let local=(await service.dispatchDetail(manager,'platform')).task;
      async function run(user,action,extra={}){local=(await service.executeDispatchAction(user,'platform',{action,expectedVersion:local.version,requestId:randomUUID(),...extra})).task;}
      await run(dispatcher,'assign',{technicianId:'tech',dueAt});await run(tech,'accept');await run(tech,'start',{itemId:1});
      await pool.query("update work_orders set dispatch_no='A12345' where id='platform'");
      await syncWorkOrderToPlatform('platform',manager.name);
      assert.equal((await repo.getDispatchTask(pool,'platform',manager)).items[0].status,'维修中');
      assert.equal((await pool.query("select status from repair_items where order_id='platform' and client_item_id=1")).rows[0].status,'维修中');
    });
    await t.test('multiple employees share visibility, notifications and one completed order',async()=>{
      await seed('team');
      let team=(await service.executeDispatchAction(advisor,'team',{action:'assign',expectedVersion:0,requestId:randomUUID(),technicianIds:[tech.id,tech2.id],dueAt})).task;
      const execute=async(actor,action,extra={})=>{team=(await service.executeDispatchAction(actor,'team',{action,expectedVersion:team.version,requestId:randomUUID(),...extra})).task;};
      assert.ok((await service.queryDispatchTasks(tech2)).some(t=>t.orderId==='team'));
      const {listWorkOrders}=await import('../server/db.mjs');
      assert.ok((await listWorkOrders('technician',tech2)).some(t=>t.id==='team'));
      assert.deepEqual((await pool.query("select recipient_id from dispatch_notifications where order_id='team' and kind='新派工' order by recipient_id")).rows.map(r=>r.recipient_id),[tech.id,tech2.id]);
      const file=randomUUID();
      await pool.query("insert into files(id,order_id,kind,storage_provider,bucket,object_key,original_name,mime_type,size_bytes,uploaded_by) values($1,'team','repair_order_photo','local','','test','repair.png','image/png',1,$2)",[file,advisor.id]);
      await assertFileReadAccess(file,tech2);
      await execute(tech2,'accept');
      await execute(tech,'start',{itemId:1});await execute(tech2,'finish',{itemId:1});
      await execute(tech2,'start',{itemId:2});await execute(tech,'finish',{itemId:2});
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
    await t.test('dispatch board includes every open order and filters workflow stages',async()=>{
      for(const [id,status] of [['board-draft','草稿'],['board-signature','待客户签字'],['board-unassigned','已委托'],['board-unsettled','待结算'],['board-closed','完成']]) await seed(id,status);
      const ids=async query=>(await service.queryDispatchTasks(advisor,query)).map(t=>t.orderId);
      const all=await ids({});
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
      task=(await service.executeDispatchAction(tech,'board-unassigned',{action:'accept',expectedVersion:task.version,requestId:randomUUID()})).task;
      assert.ok((await ids({stage:'待开工'})).includes('board-unassigned'));
      await service.executeDispatchAction(tech,'board-unassigned',{action:'start',itemId:1,expectedVersion:task.version,requestId:randomUUID()});
      assert.ok((await ids({stage:'维修中'})).includes('board-unassigned'));
      assert.ok(!(await ids({stage:'待接单'})).includes('board-unassigned'));
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
