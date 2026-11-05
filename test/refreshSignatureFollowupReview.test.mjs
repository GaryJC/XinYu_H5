import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

const adminUrl=process.env.REFRESH_SIGNATURE_TEST_ADMIN_URL;
test('reverse refresh keeps supplemental signatures tied to the displayed order',{skip:!adminUrl,timeout:120000},async t=>{
 const url=new URL(adminUrl);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
 const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
 const name=`refresh_signature_${process.pid}_${Date.now()}`,connectionsClosed=[];let pool;
 try {
  await admin.query(`create database "${name}"`);url.pathname=`/${name}`;
  Object.assign(process.env,{DATABASE_URL:url.toString(),APP_ENV:'test',RUNFENG_REPAIR_WRITEBACK_ENABLED:'false',DISPATCH_NOTIFICATION_MODE:'mock'});
  ({pool}=await import('../server/database/pool.mjs'));
  pool.on('connect',client=>connectionsClosed.push(new Promise(resolve=>client.once('end',resolve))));
  for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f!=='202608070005_remove_obsolete_runfeng_sync_role.sql').sort())await pool.query(await fs.readFile(`supabase/migrations/${file}`,'utf8'));
  const db=await import('../server/db.mjs');
  const {refreshWorkOrderFromLegacy:refresh}=await import('../server/services/workOrderRefreshService.mjs');
  const {resolvePaperOrder}=await import('../server/services/paperOrderService.mjs');
  const {loadCustomerSignature}=await import('../server/services/customerSignatureService.mjs');
  const actor={id:'refresh-manager',name:'测试管理员',active:true,role:'manager',shopId:'shop-hq'};
  await pool.query("insert into users(id,name,role,roles,shop_id) values($1,$2,'manager','{manager}',$3)",[actor.id,actor.name,actor.shopId]);
  let sequence=100;
  async function seed(paperMode){
   const id=`refresh-${randomUUID()}`,fileId=randomUUID(),reid=++sequence,dh=reid+1000,dispatchNo=`A${reid}`;
   await pool.query(`insert into work_orders(id,status,advisor,technician,inspector,old_parts_handling,legacy_sync_status,
    legacy_reid,legacy_document_no,dispatch_no,vehicle_plate,vehicle_mileage,vehicle_vin,customer_address,
    fault_description,estimated_fee,arrival_date,estimated_delivery_at)
    values($1,'维修中',$2,'甲','待检验','客户带走','synced',$3,$4,$5,'鲁BTEST','1000','VIN','地址','旧故障',100,'2026-11-01','2026-11-05')`,[id,actor.name,reid,dh,dispatchNo]);
   await pool.query("insert into repair_items(order_id,client_item_id,item_no,name,labor_fee,legacy_item_reid,status) values($1,1,1,'检查制动',100,301,'维修中')",[id]);
   await pool.query(`insert into dispatch_tasks(order_id,shop_id,stage,version,data) values($1,'shop-hq','维修中',1,'{"items":[{"id":1,"name":"检查制动","status":"维修中"}]}')`,[id]);
   await pool.query("insert into files(id,order_id,kind,storage_provider,bucket,object_key,mime_type,size_bytes,uploaded_by) values($1,$2,'signature_image','local','','fixture','image/png',8,$3)",[fileId,id,actor.id]);
   if(paperMode){
    const paperPhoto=randomUUID();
    await pool.query("insert into files(id,order_id,kind,storage_provider,bucket,object_key,mime_type,size_bytes,uploaded_by) values($1,$2,'other','local','','paper-fixture','image/png',8,$3)",[paperPhoto,id,actor.id]);
    await pool.query(`update work_orders set status=$2,paper_order=$3,legacy_sync_status='not_applicable',legacy_sync_revision=0,
     legacy_reid=null,legacy_document_no=null,dispatch_no='' where id=$1`,[id,paperMode==='pending'?'待处理纸质委托书':'草稿',JSON.stringify({mode:paperMode,photoIds:[paperPhoto]})]);
    await pool.query('delete from dispatch_tasks where order_id=$1',[id]);
    if(paperMode==='pending')await pool.query('delete from repair_items where order_id=$1',[id]);
    else await pool.query("update repair_items set status='待派工' where order_id=$1",[id]);
   }
   const session=await db.createSignatureTokenForOrder(id,actor.name,{signatureMode:'remote'});
   const source={header:{reid,dh,pgd:dispatchNo,ch:'鲁BTEST',lc:'1000',jcrq:'20261101',jhrq:'20261105',fyhj:100,wxnr:'旧故障',shbz:''},
    vehicle:{sbdm:'VIN'},customer:{jydz:'地址'},items:[{reid:301,hh:'检查制动',je:100}]};
   return {id,fileId,token:session.signatureToken,source};
  }
  const tokenState=async token=>(await pool.query('select used,expires_at from signature_tokens where token=$1',[token])).rows[0];
  await t.test('a previously opened supplemental page cannot sign updated fees or project names',async()=>{
   const {id,fileId,token,source}=await seed();
   assert.equal((await loadCustomerSignature(token)).order.estimatedFee,100);
   source.header.fyhj=200;source.items[0].je=200;source.items[0].hh='更换制动片';
   await refresh(id,actor,{readSource:async()=>source});
   let saved=false;
   await assert.rejects(()=>db.signWorkOrderByToken(token,null,null,async()=>{saved=true;return {id:fileId};}),e=>e.status===404);
   assert.equal(saved,false);assert.equal((await tokenState(token)).used,false);
   const renewed=await db.createSignatureTokenForOrder(id,actor.name,{signatureMode:'remote'});
   assert.notEqual(renewed.signatureToken,token);
   const preview=await loadCustomerSignature(renewed.signatureToken);
   assert.equal(preview.order.estimatedFee,200);assert.equal(preview.order.repairItems[0].name,'更换制动片');
   const signed=await db.signWorkOrderByToken(renewed.signatureToken,null,null,async()=>({id:fileId}));
   assert.equal(signed.customerSignatureReview.state,'pending');assert.equal(signed.status,'维修中');
  });
  await t.test('unchanged content and approval metadata retain the existing signing session',async()=>{
   const {id,token,source}=await seed(),before=await tokenState(token);
   source.header.shbz='1';
   await refresh(id,actor,{readSource:async()=>source});
   assert.deepEqual(await tokenState(token),before);assert.equal((await loadCustomerSignature(token)).state,'pending');
  });
  await t.test('a failed refresh preserves the old content and session atomically',async()=>{
   const {id,token,source}=await seed(),before=await tokenState(token);
   source.header.wxnr='新故障';
   await pool.query("create function reject_refresh_audit() returns trigger language plpgsql as $$ begin raise exception 'refresh audit failure'; end $$");
   await pool.query('create trigger reject_refresh_audit before insert on audit_logs for each row execute function reject_refresh_audit()');
   try {await assert.rejects(()=>refresh(id,actor,{readSource:async()=>source}),/refresh audit failure/);}
   finally {await pool.query('drop trigger reject_refresh_audit on audit_logs');}
   assert.deepEqual(await tokenState(token),before);assert.equal((await loadCustomerSignature(token)).order.faultDescription,'旧故障');
  });
  await t.test('refresh leaves already signed evidence and consumed token unchanged',async()=>{
   const {id,fileId,token,source}=await seed();
   await db.signWorkOrderByToken(token,null,null,async()=>({id:fileId}));
   const before=await tokenState(token),signatures=(await pool.query('select * from signatures where order_id=$1',[id])).rows;
   source.header.wxnr='更新故障';await refresh(id,actor,{readSource:async()=>source});
   assert.deepEqual(await tokenState(token),before);
   assert.deepEqual((await pool.query('select * from signatures where order_id=$1',[id])).rows,signatures);
  });
  for(const mode of ['pending','dingtalk'])await t.test(`initial paper linking invalidates the opened ${mode} supplemental page`,async()=>{
   const {id,token,source}=await seed(mode);
   assert.equal((await loadCustomerSignature(token)).state,'pending');
   source.header.fyhj=200;source.items[0].je=200;source.items[0].hh='已关联的新项目';
   await resolvePaperOrder(id,{mode:'runfeng',dispatchNo:source.header.pgd},actor,{readSource:async()=>source});
   await assert.rejects(()=>loadCustomerSignature(token),e=>e.status===404);
   assert.equal((await tokenState(token)).used,false);
   const renewed=await db.createSignatureTokenForOrder(id,actor.name,{signatureMode:'remote'});
   assert.equal((await loadCustomerSignature(renewed.signatureToken)).order.repairItems[0].name,'已关联的新项目');
  });
 } finally {
  await pool?.end();await Promise.all(connectionsClosed);
  await admin.query(`drop database if exists "${name}" with (force)`);await admin.end();
 }
});
