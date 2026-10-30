import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
const adminUrl=process.env.PAGINATION_TEST_ADMIN_URL;

test('paged lists preserve filters, counts, permissions and stable ordering across pages', {skip:!adminUrl,timeout:120000}, async()=>{
  const url=new URL(adminUrl);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
  const name=`pagination_${process.pid}_${Date.now()}`;let pool;
  try {
    await admin.query(`create database "${name}"`);url.pathname=`/${name}`;
    process.env.DATABASE_URL=url.toString();process.env.APP_ENV='test';
    pool=(await import('../server/database/pool.mjs')).pool;
    for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f!=='202608070005_remove_obsolete_runfeng_sync_role.sql').sort())await pool.query(await fs.readFile(`supabase/migrations/${file}`,'utf8'));
    const {listWorkOrders,dashboardSummary,getWorkOrderDetail}=await import('../server/db.mjs');
    const {queryDispatchTasks}=await import('../server/services/dispatchService.mjs');
    const {VehicleTripRepository}=await import('../server/repositories/vehicleTripRepository.mjs');
    const {readTenderPage}=await import('../server/repositories/procurementRepository.mjs');
    const actor={id:'paging-manager',name:'分页管理员',shopId:'paging-shop',role:'manager',active:true};
    const advisor={...actor,id:'paging-advisor',name:'分页顾问',role:'advisor'};
    for(const user of [actor,advisor])await pool.query('insert into users(id,name,role,roles,shop_id) values($1,$2,$3,array[$3],$4)',[user.id,user.name,user.role,user.shopId]);
    for(let i=0;i<46;i++) {
      const id=`paging-${String(i).padStart(3,'0')}`;
      await pool.query(`insert into work_orders(id,status,advisor,technician,inspector,old_parts_handling,shop_id,vehicle_plate,vehicle_vin,is_baiyuan_order,created_at,updated_at,legacy_sync_status)
        values($1,'维修中',$2,'甲、乙','待检验','环保处理',$3,$4,$5,$6,'2026-10-29T16:00:00Z','2026-10-30T00:00:00Z','synced')`,[id,i%2?actor.name:advisor.name,i===45?'other-shop':actor.shopId,`鲁B${i}`,i===44?'FIND-HISTORY':'',i%2===0]);
      await pool.query(`insert into signature_tokens(token,order_id) values($1,$2)`,[`token-${i}`,id]);
      await pool.query(`insert into dispatch_tasks(order_id,shop_id,stage,data) values($1,$2,'维修中',$3)`,[id,i===45?'other-shop':actor.shopId,JSON.stringify({acceptedAt:'2026-10-30T00:00:00Z',partsRequests:[{ownerId:'a',mode:'list',items:[{name:'配件'}],recordedAt:'2026-10-30T00:00:00Z'},{ownerId:'b',mode:'list',items:[{name:'配件'}],recordedAt:'2026-10-30T00:00:00Z'}]})]);
    }
    const page=n=>listWorkOrders('manager',actor,{page:String(n),pageSize:'20'});
    const first=await page(1),second=await page(2),last=await page(99);
    assert.equal(first.total,45);assert.equal(first.items.length,20);assert.equal(last.page,3);assert.equal(last.items.length,5);
    assert.equal(new Set([...first.items,...second.items,...last.items].map(x=>x.id)).size,45);
    assert.equal(first.items[0].dispatchStage,'维修中');
    assert.equal((await dashboardSummary('manager',actor)).total,45);
    const searched=await listWorkOrders('manager',actor,{page:'1',search:'find-history',from:'2026-10-29T16:00:00Z',to:'2026-10-30T16:00:00Z',technicians:'["乙"]'});
    assert.deepEqual(searched.items.map(x=>x.id),['paging-044']);
    assert.equal((await listWorkOrders('manager',actor,{page:'1',from:'2026-10-30T16:00:00Z'})).total,0);
    assert.equal((await listWorkOrders('manager',actor,{page:'1',baiyuanOnly:'true'})).total,23);
    await pool.query(`update work_orders set customer_signature_review='{"state":"pending"}' where id='paging-000'`);
    assert.equal((await listWorkOrders('manager',actor,{page:'1',statuses:'["需确认用户签字"]'})).total,1);
    const advisorPage=await listWorkOrders('advisor',advisor,{page:'1'});
    assert.equal(advisorPage.items[0].signatureToken,'token-0');assert.equal(advisorPage.items[1].signatureToken,undefined);
    assert.equal((await listWorkOrders('advisor',advisor,{refreshTargets:'true'})).length,23);
    assert.equal((await listWorkOrders('manager',actor,{refreshTargets:'true',search:'none'})).length,45);
    await assert.rejects(()=>getWorkOrderDetail('paging-045',actor),e=>e.status===403);
    const metadata=await listWorkOrders('manager',actor,{metadata:'true'});
    assert.ok(metadata.technicians.some(x=>x.value==='乙'));
    await assert.rejects(()=>listWorkOrders('manager',actor,{page:'0'}),e=>e.status===400);
    const tasks=await queryDispatchTasks(actor,{page:'2',pageSize:'20',stage:'维修中'});
    assert.equal(tasks.total,45);assert.equal(tasks.items.length,20);
    assert.equal((await queryDispatchTasks(actor,{counts:'true'}))['维修中'],45);
    const parts=await queryDispatchTasks(actor,{page:'5',pageSize:'20',partsStatus:'待备料'});
    assert.equal(parts.total,90);assert.equal(parts.items.length,10);assert.equal(parts.counts['待备料'],90);
    assert.ok(parts.items.every(task=>task.partsRequests===undefined));
    await pool.query(`insert into company_vehicles(id,shop_id,plate,brand,model) values('paging-car',$1,'鲁BPAGING','品牌','车型')`,[actor.shopId]);
    for(let i=0;i<45;i++) {
      await pool.query(`insert into vehicle_trip_requests(id,shop_id,applicant_id,applicant_name,vehicle_id,vehicle_snapshot,reason,status) values($1,$2,$3,'姓名','paging-car','{}','测试',$4)`,[`trip-${i}`,actor.shopId,i%2?actor.id:advisor.id,i%2?'已还车':'待审批']);
      await pool.query(`insert into procurement_tenders(id,shop_id,created_by,request_id,request_body,data) values($1,$2,$3,$4,'{}',$5)`,[randomUUID(),actor.shopId,actor.id,randomUUID(),JSON.stringify({partName:i===44?'历史搜索件':'配件',specification:'规格'})]);
    }
    const repo=new VehicleTripRepository(pool);
    assert.equal((await repo.listTrips(actor,{page:'3'})).items.length,5);
    assert.equal((await repo.listTrips(actor,{page:'1',scope:'mine'})).total,22);
    assert.equal((await repo.listTrips(advisor,{page:'1'})).total,23);
    assert.equal((await repo.listTrips(actor,{page:'1',scope:'using'})).total,0);
    assert.equal((await readTenderPage(actor.shopId,{page:'3'})).items.length,5);
    assert.equal((await readTenderPage(actor.shopId,{page:'1',search:'历史搜索件'})).total,1);
    assert.equal((await readTenderPage('unrelated',{page:'1'})).total,0);
  } finally {
    await pool?.end();
    await admin.query(`drop database if exists "${name}" with (force)`);await admin.end();
  }
});
