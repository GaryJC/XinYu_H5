import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';

const adminUrl=process.env.ORDER_DETAIL_TEST_ADMIN_URL;
test('archive detail matches advisor list visibility without granting write or signing access',{skip:!adminUrl},async()=>{
 const url=new URL(adminUrl);
 assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
 const name=`order_detail_test_${process.pid}_${Date.now()}`;
 const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
 let pool;const closed=[];
 try {
  await admin.query(`create database "${name}"`);url.pathname=`/${name}`;
  process.env.DATABASE_URL=url.toString();process.env.APP_ENV='test';
  ({pool}=await import('../server/database/pool.mjs'));
  pool.on('connect',client=>closed.push(new Promise(resolve=>client.once('end',resolve))));
  for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f!=='202608070005_remove_obsolete_runfeng_sync_role.sql').sort())await pool.query(await fs.readFile(`supabase/migrations/${file}`,'utf8'));
  const {listWorkOrders,getWorkOrderDetail}=await import('../server/db.mjs');
  const {readOrderOverview}=await import('../server/repositories/orderOverviewRepository.mjs');
  const {assertWorkOrderAccess}=await import('../server/repositories/accessRepository.mjs');
  const {createFileRecord,assertFileReadAccess,assertFileAccess}=await import('../server/repositories/fileRepository.mjs');
  const viewer={id:'advisor-b',name:'乙顾问',role:'advisor',active:true,shopId:'shop-hq'};
  await pool.query("insert into work_orders(id,status,advisor,technician,inspector,shop_id,old_parts_handling) values('detail-test','待客户签字','甲顾问','待派工','待检验','shop-hq','客户带走')");
  await pool.query("insert into signature_tokens(token,order_id) values('private-signature','detail-test')");
  const page=await listWorkOrders('advisor',viewer,{page:'1',pageSize:'20',view:'summary'});
  assert.ok(page.items.some(order=>order.id==='detail-test'));
  const detail=await getWorkOrderDetail('detail-test',viewer);
  assert.equal(detail.id,'detail-test');assert.equal(detail.advisor,'甲顾问');
  assert.equal(detail.signatureToken,undefined);assert.equal(detail.signatureTokenUsed,undefined);
  const overview=await readOrderOverview('detail-test',viewer);
  assert.equal(overview.order.id,'detail-test');assert.equal(overview.order.signatureToken,undefined);
  await assert.rejects(()=>readOrderOverview('detail-test',{...viewer,shopId:'other'}),e=>e.status===403);
  const file=await createFileRecord({orderId:'detail-test',kind:'vehicle_license',bucket:'test',objectKey:'test-only',mimeType:'image/jpeg',sizeBytes:1});
  await assertFileReadAccess(file.id,viewer);
  await assert.rejects(()=>assertFileReadAccess(file.id,{...viewer,shopId:'other'}),e=>e.status===403);
  await assert.rejects(()=>assertFileAccess(file.id,viewer),e=>e.status===403);
  assert.equal((await getWorkOrderDetail('detail-test',{...viewer,name:'甲顾问'})).signatureToken,'private-signature');
  await assert.rejects(()=>assertWorkOrderAccess('detail-test',viewer),e=>e.status===403);
  for(const user of [{...viewer,shopId:'other'},...['employee','technician','inspector','outsourcing'].map(role=>({...viewer,role}))])await assert.rejects(()=>getWorkOrderDetail('detail-test',user),e=>e.status===403);
  await assert.rejects(()=>getWorkOrderDetail('missing',viewer),e=>e.status===404);
 } finally {
  if(pool)await pool.end();await Promise.all(closed);
  await admin.query(`drop database if exists "${name}" with (force)`);await admin.end();
 }
});
