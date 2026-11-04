import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

const adminUrl=process.env.PROCUREMENT_TEST_ADMIN_URL;
test('procurement review protects quoted terms and explicit award confirmation',{skip:!adminUrl,timeout:120000},async t=>{
 const url=new URL(adminUrl);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
 const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
 const dbName=`procurement_followup_${process.pid}_${Date.now()}`,connectionsClosed=[];let pool;
 try {
  await admin.query(`create database "${dbName}"`);url.pathname=`/${dbName}`;
  Object.assign(process.env,{DATABASE_URL:url.toString(),APP_ENV:'test',DISPATCH_NOTIFICATION_MODE:'mock',RUNFENG_REPAIR_WRITEBACK_ENABLED:'false'});
  pool=(await import('../server/database/pool.mjs')).pool;
  pool.on('connect',client=>connectionsClosed.push(new Promise(resolve=>client.once('end',resolve))));
  for(const file of (await fs.readdir('supabase/migrations')).filter(file=>file.endsWith('.sql')&&file!=='202608070005_remove_obsolete_runfeng_sync_role.sql').sort())await pool.query(await fs.readFile(`supabase/migrations/${file}`,'utf8'));
  const manager={id:'procurement-review-manager',name:'采购管理员',role:'manager',shopId:'shop-hq',active:true};
  const warehouse={...manager,id:'procurement-review-warehouse',name:'采购仓管',role:'warehouse'};
  for(const user of [manager,warehouse])await pool.query('insert into users(id,name,role,roles,shop_id,active) values($1,$2,$3,array[$3],$4,true)',[user.id,user.name,user.role,user.shopId]);
  const service=await import('../server/services/procurementService.mjs');
  const supplier=await service.updateSupplier(warehouse,null,{name:'隔离测试供应商',contactName:'测试联系人',phone:'13800000001',categories:'',note:'',active:true});
  const future=days=>new Date(Date.now()+days*86400000).toISOString();
  async function seeded(){
   const created=await service.publishTender(warehouse,{requestId:randomUUID(),partName:'测试配件',quantity:2,unit:'件',deliveryBy:future(3),supplierIds:[supplier.id],deadline:null});
   const {session}=await service.verifyPortal({token:created.sharedLink.token,phone:supplier.phone,identity:supplier.name},'isolated-followup');
   const view=await service.portal(session);
   const quote={requestId:randomUUID(),invitationId:view.invitationId,termsVersion:1,unitPriceFen:10000,freightFen:0,deliveryAt:future(2),meetsRequirements:true,note:''};
   await service.quote(session,quote);
   return {created,session,quote};
  }
  await t.test('a stale award cannot confirm a changed quantity and price after reopening',async()=>{
   const {created,session,quote}=await seeded();
   const closed=(await service.tenderAction(manager,created.tender.id,{action:'close'})).tender;
   assert.equal(closed.invitations[0].quotes[0].totalFen,20000);
   const changed=(await service.tenderAction(warehouse,closed.id,{...closed.data,quantity:3,deadline:null,action:'update',expectedVersion:closed.version,reopen:true})).tender;
   await service.quote(session,{...quote,requestId:randomUUID(),termsVersion:changed.termsVersion});
   const latest=(await service.tenderAction(warehouse,closed.id,{action:'close'})).tender;
   assert.equal(latest.invitations[0].quotes[0].totalFen,30000);
   assert.ok(latest.version>closed.version);
   await assert.rejects(()=>service.tenderAction(manager,closed.id,{action:'settle',winnerIds:[supplier.id],reason:''}),error=>error.status===409);
   await assert.rejects(()=>service.tenderAction(manager,closed.id,{action:'settle',expectedVersion:closed.version,winnerIds:[supplier.id],reason:''}),error=>error.status===409);
   assert.equal((await service.tenderDetail(manager,closed.id)).tender.status,'closed');
   const awarded=(await service.tenderAction(manager,closed.id,{action:'settle',expectedVersion:latest.version,winnerIds:[supplier.id],reason:''})).tender;
   assert.equal(awarded.status,'awarded');assert.equal(awarded.winnerId,supplier.id);
   assert.equal(awarded.invitations[0].quotes[0].totalFen,30000);
  });
  await t.test('invalidating the last valid offer cannot turn an explicit award into a failed tender',async()=>{
   const {created}=await seeded();
   const closed=(await service.tenderAction(manager,created.tender.id,{action:'close'})).tender;
   const invalidation={action:'invalidate',invitationId:closed.invitations[0].id,reason:'规格不符'};
   const invalidated=(await service.tenderAction(warehouse,closed.id,invalidation)).tender;
   assert.equal(invalidated.version,closed.version+1);
   assert.equal((await service.tenderAction(warehouse,closed.id,invalidation)).tender.version,invalidated.version,'unchanged qualification must not invalidate a current confirmation');
   await assert.rejects(()=>service.tenderAction(manager,closed.id,{action:'settle',expectedVersion:closed.version,winnerIds:[supplier.id],reason:''}),error=>error.status===409);
   await assert.rejects(()=>service.tenderAction(manager,closed.id,{action:'settle',expectedVersion:invalidated.version,winnerIds:[supplier.id],reason:''}),error=>error.status===409);
   assert.equal((await service.tenderDetail(manager,closed.id)).tender.status,'closed');
   const restored=(await service.tenderAction(warehouse,closed.id,{...invalidation,reason:''})).tender;
   assert.equal(restored.version,invalidated.version+1);
   assert.equal((await service.tenderAction(manager,closed.id,{action:'settle',expectedVersion:restored.version,winnerIds:[supplier.id]})).tender.status,'awarded');
  });
  await t.test('an identical accepted quote remains an idempotent retry after quantity changes',async()=>{
   const {created,session,quote}=await seeded();
   const before=(await service.tenderDetail(manager,created.tender.id)).tender;
   await service.tenderAction(warehouse,before.id,{...before.data,quantity:3,deadline:null,action:'update',expectedVersion:before.version});
   const count=async table=>(await pool.query(`select count(*)::integer as total from ${table}`)).rows[0].total;
   const quotes=await count('procurement_quotes'),notices=await count('procurement_notification_jobs');
   assert.deepEqual(await service.quote(session,quote),{ok:true});
   for(const patch of [{unitPriceFen:9000},{freightFen:100},{termsVersion:2}])await assert.rejects(()=>service.quote(session,{...quote,...patch}),error=>error.status===409);
   assert.equal(await count('procurement_quotes'),quotes);assert.equal(await count('procurement_notification_jobs'),notices);
   const after=(await service.tenderDetail(manager,before.id)).tender;
   assert.equal(after.termsVersion,2);assert.equal(after.invitations[0].quotes[0].totalFen,20000);
   assert.equal(after.invitations[0].quotes[0].termsVersion,1);
  });
  await t.test('an elapsed deadline can be confirmed with the version displayed before automatic closure',async()=>{
   const {created}=await seeded();
   await pool.query("update procurement_tenders set deadline=clock_timestamp()-interval '1 second' where id=$1",[created.tender.id]);
   const displayed=(await service.tenderDetail(manager,created.tender.id)).tender;
   assert.equal(displayed.status,'closed');
   assert.equal((await pool.query('select status from procurement_tenders where id=$1',[created.tender.id])).rows[0].status,'open');
   const awarded=(await service.tenderAction(manager,created.tender.id,{action:'settle',expectedVersion:displayed.version,winnerIds:[supplier.id]})).tender;
   assert.equal(awarded.status,'awarded');assert.equal(awarded.winnerId,supplier.id);
  });
 } finally {
  await pool?.end();await Promise.all(connectionsClosed);
  await admin.query(`drop database if exists "${dbName}" with (force)`);await admin.end();
 }
});
