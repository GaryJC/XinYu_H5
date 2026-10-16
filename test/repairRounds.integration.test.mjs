import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
const adminUrl=process.env.REPAIR_ROUNDS_TEST_ADMIN_URL;
test('repair rounds persist independently, serialize concurrent reopen and preserve commercial records',{skip:!adminUrl,timeout:120000},async()=>{
 const url=new URL(adminUrl);assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
 const admin=new pg.Client({connectionString:adminUrl});await admin.connect();const dbName=`codex_round_test_${Date.now()}_${process.pid}`;let pool;
 try {
  await admin.query(`create database "${dbName}"`);url.pathname=`/${dbName}`;process.env.DATABASE_URL=url.toString();process.env.APP_ENV='test';process.env.DISPATCH_NOTIFICATION_MODE='mock';
  pool=(await import('../server/database/pool.mjs')).pool;
  for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f!=='202608070005_remove_obsolete_runfeng_sync_role.sql').sort())await pool.query(await fs.readFile(`supabase/migrations/${file}`,'utf8'));
  const manager={id:'m',name:'管理员',role:'manager',shopId:'shop-hq',active:true},advisor={...manager,id:'a',name:'顾问',role:'advisor'},tech={...manager,id:'t',name:'原技师',role:'technician'},newTech={...tech,id:'t2',name:'新技师'},inspector={...manager,id:'i',name:'检验员',role:'inspector'},outside={...manager,id:'o',shopId:'other'};
  for(const p of [manager,advisor,tech,newTech,inspector,outside])await pool.query('insert into users(id,name,role,shop_id,active,dingtalk_user_id) values($1,$2,$3,$4,true,$1)',[p.id,p.name,p.role,p.shopId]);
  const svc=await import('../server/services/dispatchService.mjs'),repo=await import('../server/repositories/dispatchRepository.mjs'),db=await import('../server/db.mjs');
  const {uploadRepairPhoto}=await import('../server/services/repairPhotoService.mjs');
  const {createFileRecord,assertFileReadAccess}=await import('../server/repositories/fileRepository.mjs');
  const {processNotification}=await import('../server/workers/dispatchNotifications.mjs');
  const {queueDueReminders}=await import('../server/workers/dueReminders.mjs');
  const dueAt=new Date(Date.now()+36*3600000).toISOString();
  async function seed(id,status) {
   await pool.query("insert into work_orders(id,status,advisor,technician,inspector,shop_id,old_parts_handling,vehicle_plate,arrival_date,estimated_fee,settlement_amount,dispatch_no) values($1,$2,'顾问','原技师','检验员','shop-hq','客户带走','沪ATEST','2026-10-01',500,500,$3)",[id,status,`A${id==='closed'?100:101}`]);
   for(const item of [1,2]) await pool.query("insert into repair_items(order_id,client_item_id,item_no,name,status,owner,start_at,finish_at,inspector,labor_fee) values($1,$2::bigint,$2::integer,$3,'已完工','原技师','2026-10-01','2026-10-02','检验员',250)",[id,item,`原项目${item}`]);
   const task=await repo.getDispatchTask(pool,id,manager);Object.assign(task,{stage:'维修完成',version:1,technicianIds:['t'],technicianId:'t',technicianName:'原技师',participantIds:['t'],workHours:2,workHoursRecordedBy:'a',workHoursRecordedName:'顾问',workHoursRecordedAt:'2026-10-02T00:00:00Z',completedAt:'2026-10-02T00:00:00Z',firstStartedAt:'2026-10-01T00:00:00Z'});await repo.saveDispatchTask(pool,task);
  }
  await seed('closed','完成');await seed('unsettled','待结算');
  await pool.query("insert into settlement_statements(id,order_id,dispatch_no,plate,technician,amount,source,match_status) values('settle','closed','A100','沪ATEST','原技师',500,'维修业务平台','已匹配')");
  const before=(await pool.query("select * from work_orders where id='closed'")).rows[0];const itemsBefore=(await pool.query("select * from repair_items where order_id='closed' order by item_no")).rows;
  let task=(await svc.dispatchDetail(manager,'closed')).task;
  const reopen={action:'reopen-repair',expectedVersion:task.version,requestId:randomUUID(),reason:'交车后异响',reworkItemIds:[1],additionalItems:['补充检查'],technicianIds:['t2'],dueAt};
  await assert.rejects(()=>svc.executeDispatchAction(outside,'closed',reopen),e=>e.status===403);await assert.rejects(()=>svc.executeDispatchAction(tech,'closed',reopen),e=>e.status===403);
  await pool.query("update users set active=false where id='a'");await assert.rejects(()=>svc.executeDispatchAction(advisor,'closed',reopen),e=>e.status===403);await pool.query("update users set active=true where id='a'");
  const results=await Promise.allSettled([svc.executeDispatchAction(advisor,'closed',reopen),svc.executeDispatchAction(manager,'closed',{...reopen,requestId:randomUUID()})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  // Replay the exact successful request even after the version has moved.
  const winner=results[0].status==='fulfilled'?advisor:manager;const request=results[0].status==='fulfilled'?reopen:undefined;
  if(request)await svc.executeDispatchAction(winner,'closed',request);
  task=(await svc.dispatchDetail(manager,'closed')).task;
  assert.equal(task.stage,'待接单');assert.equal(task.orderStatus,'完成');assert.equal(task.repairRound,1);
  assert.equal((await pool.query("select count(*) from dispatch_repair_rounds where order_id='closed'")).rows[0].count,'2');
  assert.equal((await pool.query("select count(*) from dispatch_notifications where kind='返工派工' and order_id='closed'")).rows[0].count,'1');
  assert.ok((await svc.queryDispatchTasks(manager)).some(t=>t.orderId==='closed'));assert.ok((await svc.queryDispatchTasks(newTech,{stage:'待接单'})).some(t=>t.orderId==='closed'));assert.equal((await svc.myRepairCounts(newTech)).pendingAccept,1);
  assert.ok(!(await svc.queryDispatchTasks(manager,{stage:'完成'})).some(t=>t.orderId==='closed'));
  await queueDueReminders();assert.equal((await pool.query("select count(*) from dispatch_due_reminders where order_id='closed' and repair_round=1")).rows[0].count,'1');
  await processNotification({send:async()=>({status:'failed',error:'模拟发送失败',retryable:false})});assert.equal((await svc.dispatchDetail(manager,'closed')).task.stage,'待接单');
  async function act(user,action,extra={},id='closed') {const t=(await svc.dispatchDetail(manager,id)).task;const detail=await svc.executeDispatchAction(user,id,{action,expectedVersion:t.version,requestId:randomUUID(),...(action==='inspect'&&!extra.rejectedItemIds?.length?{workHours:2.5}:{}),...(action==='accept'?{partsRequirement:{mode:'none',items:[],photoIds:[]}}:{}),...extra});return detail.task;}
  await createFileRecord({orderId:'closed',kind:'repair_progress_photo',storageProvider:'local',bucket:'',objectKey:'historic',mimeType:'image/png',sizeBytes:4,uploadedBy:tech.id});
  task=await act(newTech,'accept');await assert.rejects(()=>act(newTech,'submit-order'),/本轮维修照片/);assert.equal(task.stage,'维修中');task=await act(newTech,'pause',{pauseReason:'待配件'});task=await act(newTech,'resume');
  const body={requestId:randomUUID(),repairRound:1,fileName:'维修.jpg',mimeType:'image/jpeg',imageBase64:Buffer.from([255,216,255,217]).toString('base64')};
  const save=async data=>createFileRecord({...data,storageProvider:'local',bucket:'',objectKey:'test',originalName:data.fileName,sizeBytes:4});
  const photo=await uploadRepairPhoto(newTech,'closed',body,{save});assert.equal((await uploadRepairPhoto(newTech,'closed',body,{save})).id,photo.id);
  assert.equal((await pool.query('select repair_round from files where id=$1',[photo.id])).rows[0].repair_round,1);
  await assert.rejects(()=>uploadRepairPhoto(newTech,'closed',{...body,repairRound:0,requestId:randomUUID()},{save}),e=>e.status===409);
  task=await act(newTech,'submit-order');await assertFileReadAccess(photo.id,inspector);await assert.rejects(()=>assertFileReadAccess(photo.id,outside),e=>e.status===403);
  await assert.rejects(()=>svc.executeDispatchAction(newTech,'closed',{action:'claim-inspection',expectedVersion:task.version,requestId:randomUUID()}),e=>e.status===403);
  const claims=await Promise.allSettled([act(inspector,'claim-inspection'),act(manager,'claim-inspection')]);assert.equal(claims.filter(r=>r.status==='fulfilled').length,1);task=(await svc.dispatchDetail(manager,'closed')).task;
  const checker=task.inspectorId==='i'?inspector:manager;
  task=await act(checker,'inspect',{rejectedItemIds:[-1],reason:'复查未通过'});assert.equal(task.repairRound,1);assert.equal(task.items[0].status,'已完工');task=await act(newTech,'start-order');task=await act(newTech,'submit-order');task=await act(inspector,'claim-inspection');task=await act(inspector,'inspect');
  assert.equal(task.orderStatus,'完成');assert.equal(task.stage,'维修完成');assert.equal((await svc.technicianSummaries(manager)).find(p=>p.id==='t2').completed,1);
  const detail=await svc.dispatchDetail(manager,'closed');assert.equal(detail.repairRounds.length,2);assert.ok(detail.repairRounds.every(r=>r.closed));const firstRound=detail.repairRounds[1];
  const second=await svc.executeDispatchAction(manager,'closed',{...reopen,expectedVersion:task.version,requestId:randomUUID(),reworkItemIds:[2],additionalItems:['下一轮检查'],technicianIds:['t']});assert.equal(second.task.repairRound,2);assert.ok(second.task.items.some(i=>i.id===-2));assert.equal(second.task.items[0].id,2);
  assert.deepEqual(second.repairRounds[1],firstRound);await assert.rejects(()=>uploadRepairPhoto(newTech,'closed',body,{save}),e=>e.status===403);
  const after=(await pool.query("select * from work_orders where id='closed'")).rows[0];delete before.updated_at;delete after.updated_at;assert.deepEqual(after,before);assert.deepEqual((await pool.query("select * from repair_items where order_id='closed' order by item_no")).rows,itemsBefore);
  assert.equal((await pool.query("select count(*) from settlement_statements where order_id='closed'")).rows[0].count,'1');assert.equal((await pool.query("select count(*) from legacy_sync_outbox where order_id='closed'")).rows[0].count,'0');
  task=await act(advisor,'reopen-repair',{reason:'保修检查',reworkItemIds:[],additionalItems:['只补充项目'],technicianIds:['t'],dueAt},'unsettled');
  await assert.rejects(()=>db.transitionWorkOrder('unsettled','完成',advisor.name,'完结'),e=>e.status===409);await assert.rejects(()=>db.createSettlementForOrder('unsettled',advisor.name),e=>e.status===409);
  await createFileRecord({orderId:'unsettled',kind:'repair_progress_photo',storageProvider:'local',bucket:'',objectKey:'fixture',mimeType:'image/png',sizeBytes:4,uploadedBy:tech.id});
  const roundPhoto=(await pool.query("select id from files where order_id='unsettled' and kind='repair_progress_photo'")).rows[0];await pool.query('update files set repair_round=1 where id=$1',[roundPhoto.id]);
  for(const action of ['accept','submit-order'])await act(tech,action,{},'unsettled');await act(inspector,'claim-inspection',{},'unsettled');await act(inspector,'inspect',{},'unsettled');await db.transitionWorkOrder('unsettled','完成',advisor.name,'完结');assert.equal((await pool.query("select status from work_orders where id='unsettled'")).rows[0].status,'完成');
 } finally {if(pool)await pool.end();await admin.query(`drop database if exists "${dbName}" with (force)`);await admin.end();}
});
