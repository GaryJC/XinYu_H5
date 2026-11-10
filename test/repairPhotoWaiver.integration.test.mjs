import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
const adminUrl=process.env.PHOTO_WAIVER_TEST_ADMIN_URL;
test('photo waiver PostgreSQL permissions, atomic decisions and completion enforcement',{skip:!adminUrl,timeout:120000},async t=>{
 const url=new URL(adminUrl);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
 const name=`photo_waiver_test_${process.pid}_${Date.now()}`;
 const admin=new pg.Client({connectionString:adminUrl});await admin.connect();let pool;const connectionsClosed=[];
 try {
  await admin.query(`create database "${name}"`);url.pathname=`/${name}`;
  process.env.DATABASE_URL=url.toString();process.env.APP_ENV='test';process.env.DISPATCH_NOTIFICATION_MODE='mock';process.env.RUNFENG_REPAIR_WRITEBACK_ENABLED='false';
  const database=await import('../server/database/pool.mjs');pool=database.pool;pool.on('connect',client=>connectionsClosed.push(new Promise(resolve=>client.once('end',resolve))));
  for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f!=='202608070005_remove_obsolete_runfeng_sync_role.sql').sort())await pool.query(await fs.readFile(`supabase/migrations/${file}`,'utf8'));
  const worker={id:'waiver-a',name:'甲',role:'technician',active:true,shopId:'shop-hq'};
  const peer={...worker,id:'waiver-b',name:'乙'};
  const manager={...worker,id:'waiver-m',name:'管理员',role:'manager'};
  const advisor={...worker,id:'waiver-d',name:'顾问',role:'advisor'};
  const inspector={...worker,id:'waiver-i',name:'检验员',role:'inspector'};
  const outside={...manager,id:'waiver-out',shopId:'other'};
  for(const p of [worker,peer,manager,advisor,inspector,outside])await pool.query('insert into users(id,name,role,roles,shop_id,active) values($1,$2,$3,$4,$5,true)',[p.id,p.name,p.role,[p.role],p.shopId]);
  for(const [index,p] of [worker,peer].entries())await pool.query("update users set legacy_employee_code=$2,legacy_employee_name=name,legacy_employee_department='test',legacy_employee_bound_at=now() where id=$1",[p.id,String(index+1).padStart(3,'0')]);
  const service=await import('../server/services/dispatchService.mjs');const repo=await import('../server/repositories/dispatchRepository.mjs');
  const detail=id=>service.dispatchDetail(manager,id);
  async function seed(extra={}) {
   const id=`waiver-${randomUUID()}`;
   await pool.query("insert into work_orders(id,status,advisor,technician,inspector,shop_id,old_parts_handling,vehicle_plate,arrival_date) values($1,'维修中','顾问','甲、乙','待检验','shop-hq','客户带走','鲁B12345','2026-11-10')",[id]);
   await repo.saveDispatchTask(pool,{orderId:id,shopId:'shop-hq',orderStatus:'维修中',stage:'维修中',version:1,executionMode:'field',technicianId:worker.id,technicianIds:[worker.id,peer.id],technicianName:'甲、乙',assignedAt:'2026-11-10T00:00:00Z',firstStartedAt:'2026-11-10T00:01:00Z',partsRequests:[worker,peer].map(p=>({ownerId:p.id,mode:'none',items:[],photoIds:[]})),items:[{id:1,name:'甲检修',responsibleId:worker.id,status:'维修中',startAt:'2026-11-10T00:01:00Z'},{id:2,name:'乙检修',responsibleId:peer.id,status:'维修中',startAt:'2026-11-10T00:01:00Z'}],...extra});
   return id;
  }
  async function command(id,actor,action,extra={},request) {
   const task=(await detail(id)).task;
   return service.executeDispatchAction(actor,id,request||{action,expectedVersion:task.version,requestId:randomUUID(),...extra});
  }
  const apply=(id,actor=worker)=>command(id,actor,'request-photo-waiver',{reason:'现场禁止拍照，手机上交'});
  async function approve(id,actor=advisor,applicant=worker) {
   const task=(await detail(id)).task;
   return command(id,actor,'approve-photo-waiver',{waiverId:task.repairPhotoWaivers.find(row=>row.applicantId===applicant.id).id});
  }
  await t.test('pending/rejected cannot submit, approved worker can submit while peer still needs evidence',async()=>{
   const id=await seed();await apply(id);
   await assert.rejects(()=>command(id,worker,'submit-order'),e=>e.status===409&&/照片/.test(e.message));
   const request=(await detail(id)).task.repairPhotoWaivers[0];
   await command(id,advisor,'reject-photo-waiver',{waiverId:request.id,reason:'请核对现场要求'});
   await assert.rejects(()=>command(id,worker,'submit-order'),e=>e.status===409);
   await apply(id);await approve(id);
   const completed=await command(id,worker,'submit-order');assert.equal(completed.task.items[0].status,'待检验');assert.equal(completed.task.items[1].status,'维修中');
   await assert.rejects(()=>command(id,peer,'submit-order'),e=>e.status===409&&/照片/.test(e.message));
   const events=completed.events.filter(e=>e.detail.photoWaiver);assert.equal(events.length,4);assert.ok(events.every(e=>e.detail.photoWaiver.reason==='现场禁止拍照，手机上交'));
  });
  await t.test('permission checks use current user roles; self, wrong shop and inactive applicants are rejected',async()=>{
   const id=await seed();await apply(id);
   await assert.rejects(()=>approve(id,outside),e=>e.status===403);
   await assert.rejects(()=>approve(id,inspector),e=>e.status===403);
   await pool.query("update users set roles=array['technician','manager'] where id=$1",[worker.id]);
   await assert.rejects(()=>approve(id,worker),e=>e.status===403&&/自己/.test(e.message));
   await pool.query("update users set roles=array['technician'] where id=$1",[worker.id]);
   await pool.query("update users set roles=array['employee'] where id=$1",[advisor.id]);
   await assert.rejects(()=>approve(id,advisor),e=>e.status===403);
   await pool.query("update users set roles=array['advisor'] where id=$1",[advisor.id]);
   await pool.query('update users set active=false where id=$1',[worker.id]);
   await assert.rejects(()=>approve(id),e=>e.status===409);
   await pool.query('update users set active=true where id=$1',[worker.id]);await approve(id);
   await pool.query("update users set roles=array['employee'] where id=$1",[worker.id]);
   await assert.rejects(()=>command(id,worker,'submit-order'),e=>e.status===403);
   await pool.query("update users set roles=array['technician'] where id=$1",[worker.id]);
  });
  await t.test('concurrent approve/reject has one winner; response-loss retry records one decision',async()=>{
   const id=await seed();const applied=await apply(id);const waiverId=applied.task.repairPhotoWaivers[0].id;
   const requests=['approve-photo-waiver','reject-photo-waiver'].map(action=>({action,expectedVersion:applied.task.version,requestId:randomUUID(),waiverId,...(action==='reject-photo-waiver'?{reason:'需核对'}:{})}));
   const actors=[advisor,manager];const results=await Promise.allSettled(requests.map((r,i)=>command(id,actors[i],r.action,{},r)));
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
   const winner=results.findIndex(r=>r.status==='fulfilled');await command(id,actors[winner],requests[winner].action,{},requests[winner]);
   assert.equal((await pool.query("select count(*)::integer n from dispatch_events where order_id=$1 and action in ('approve-photo-waiver','reject-photo-waiver')",[id])).rows[0].n,1);
   await assert.rejects(()=>command(id,actors[winner],requests[winner].action,{}, {...requests[winner],reason:'变更内容'}),e=>e.status===409);
  });
  await t.test('completion edits cannot expand exemption; saved project changes and review invalidate it',async()=>{
   const id=await seed();await apply(id);await approve(id);
   await assert.rejects(()=>command(id,worker,'submit-order',{repairItems:[{id:1,name:'换项目',responsibleId:worker.id}]}),e=>e.status===409&&/照片/.test(e.message));
   assert.equal((await detail(id)).task.items[0].name,'甲检修','failed command rolls back project changes');
   await command(id,worker,'edit-repair-items',{repairItems:[{id:1,name:'换项目',responsibleId:worker.id}]});
   assert.equal((await detail(id)).task.repairPhotoWaivers.length,0);
   await command(id,worker,'edit-repair-items',{repairItems:[{id:1,name:'甲检修',responsibleId:worker.id}]});
   await assert.rejects(()=>command(id,worker,'submit-order'),e=>e.status===409);
  });
  await t.test('personal rejection invalidates only that worker and does not strand rework applications',async()=>{
   const id=await seed();await apply(id);await approve(id);await apply(id,peer);await approve(id,advisor,peer);
   await command(id,worker,'submit-order');await command(id,manager,'inspect',{rejectedItemIds:[1],reason:'返修'});
   const returned=(await detail(id)).task;
   assert.equal(returned.repairPhotoWaivers.some(entry=>entry.applicantId===worker.id),false);
   assert.equal(returned.repairPhotoWaivers.find(entry=>entry.applicantId===peer.id).status,'approved');
   await command(id,worker,'start-order');await assert.rejects(()=>command(id,worker,'submit-order'),e=>e.status===409);
   await apply(id);assert.ok((await service.queryDispatchTasks(advisor,{stage:'无照片待审批'})).some(task=>task.orderId===id));
   await approve(id);await command(id,worker,'submit-order');await command(id,peer,'submit-order');
   assert.equal((await detail(id)).task.stage,'待检验');
  });
  await t.test('same request IDs across workers preserve independent decisions, audit and counts',async()=>{
   const id=await seed(),sharedId=randomUUID();
   for(const actor of [worker,peer]) {
    const task=(await detail(id)).task;
    await command(id,actor,'request-photo-waiver',{}, {action:'request-photo-waiver',expectedVersion:task.version,requestId:sharedId,reason:'现场无法拍照'});
   }
   const requested=(await detail(id));const [a,b]=requested.task.repairPhotoWaivers;
   assert.notEqual(a.id,b.id);assert.ok(requested.events.filter(e=>e.action==='request-photo-waiver').every(e=>e.detail.photoWaiver));
   await command(id,advisor,'approve-photo-waiver',{waiverId:b.id});
   const next=(await detail(id)).task;
   assert.equal(next.repairPhotoWaivers.find(e=>e.id===a.id).status,'pending');
   await assert.rejects(()=>command(id,worker,'submit-order'),e=>e.status===409);
   await command(id,peer,'submit-order');
   const visible=await service.queryDispatchTasks(advisor,{stage:'无照片待审批'});
   assert.ok(visible.some(task=>task.orderId===id));
  });
  await t.test('whole review and a reopened repair round require fresh personal approvals',async()=>{
   const id=await seed();await apply(id);await approve(id);await apply(id,peer);await approve(id,advisor,peer);
   await command(id,worker,'submit-order');await command(id,peer,'submit-order');
   await command(id,manager,'send-review');
   assert.equal((await detail(id)).task.repairPhotoWaivers,undefined);
   await assert.rejects(()=>command(id,worker,'submit-review'),e=>e.status===409);
   await apply(id);await approve(id);await command(id,worker,'submit-review');
   await assert.rejects(()=>command(id,peer,'submit-review'),e=>e.status===409);
   await apply(id,peer);await approve(id,advisor,peer);await command(id,peer,'submit-review');
   await command(id,manager,'inspect',{workHours:2});
   await command(id,manager,'reopen-repair',{executionMode:'internal',technicianIds:[worker.id],reworkItemIds:[1],reason:'下一轮返工',dueAt:new Date(Date.now()+86400000).toISOString()});
   const reopened=(await detail(id)).task;
   assert.equal(reopened.repairRound,1);assert.equal(reopened.repairPhotoWaivers.length,0);
   assert.ok((await detail(id)).repairRounds.find(round=>round.round===0).task.repairPhotoWaivers.length,'history keeps prior decisions for audit');
  });
  await t.test('approval writes metadata/audit only, and request retries are idempotent',async()=>{
   const id=await seed();const task=(await detail(id)).task;
   const input={action:'request-photo-waiver',reason:'禁止拍照',expectedVersion:task.version,requestId:randomUUID()};const calls=[];
   await database.transaction(client=>service.executeDispatchActionInTransaction({query(sql,params){calls.push(sql);return client.query(sql,params);}},worker,id,input));
   assert.ok(!calls.some(sql=>/insert into repair_items|delete from repair_items|insert into dispatch_notifications|insert into dispatch_scheduler_notifications/.test(sql)));
   await command(id,worker,input.action,{},input);
   assert.equal((await pool.query('select count(*)::integer n from dispatch_events where order_id=$1',[id])).rows[0].n,1);
  });
  await t.test('single-worker and outsourced completion use the actual applicant, not any approval on the order',async()=>{
   const id=await seed({technicianIds:[worker.id],technicianId:worker.id,partsRequests:undefined,partsRequirement:{mode:'none',items:[],photoIds:[]},items:[{id:1,name:'甲检修',responsibleId:worker.id,status:'维修中'}]});
   await apply(id);await approve(id);assert.equal((await command(id,worker,'submit-order')).task.stage,'待检验');
   const external=await seed({executionMode:'outsourced',contractor:'外包单位',assignedBy:advisor.id,partsRequests:undefined,partsRequirement:{mode:'none',items:[],photoIds:[]}});
   await apply(external,advisor);await approve(external,manager,advisor);
   await assert.rejects(()=>command(external,manager,'complete-outsourced'),e=>e.status===409&&/照片/.test(e.message));
   assert.equal((await command(external,advisor,'complete-outsourced')).task.stage,'维修完成');
  });
 } finally {if(pool)await pool.end();await Promise.all(connectionsClosed);await admin.query(`drop database if exists "${name}" with (force)`);await admin.end();}
});
