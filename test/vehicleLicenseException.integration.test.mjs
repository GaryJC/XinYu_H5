import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
const adminUrl=process.env.LICENSE_EXCEPTION_TEST_ADMIN_URL;
test('vehicle license exception persistence, signature rules, administrator fanout and notification delivery',{skip:!adminUrl,timeout:120000},async()=>{
 const url=new URL(adminUrl);assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
 const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
 const name=`codex_license_test_${Date.now()}_${process.pid}`;let pool;
 const connectionsClosed=[];
 try {
  await admin.query(`create database "${name}"`);url.pathname=`/${name}`;
  process.env.DATABASE_URL=url.toString();process.env.APP_ENV='test';process.env.DISPATCH_NOTIFICATION_MODE='mock';
  pool=(await import('../server/database/pool.mjs')).pool;
  pool.on('connect',client=>connectionsClosed.push(new Promise(resolve=>client.once('end',resolve))));
  for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f!=='202608070005_remove_obsolete_runfeng_sync_role.sql').sort())await pool.query(await fs.readFile(`supabase/migrations/${file}`,'utf8'));
  const advisor={id:'a',name:'顾问甲',role:'advisor',shopId:'shop-hq',active:true};
  const manager={id:'m1',name:'管理员甲',role:'manager',shopId:'shop-hq',active:true};
  const others=[{...manager,id:'m2',name:'管理员乙'},{...manager,id:'outside',shopId:'other'},{...manager,id:'disabled',active:false},{...advisor,id:'a2',name:'顾问乙'},{...advisor,id:'t',role:'technician'}];
  for(const p of [advisor,manager,...others])await pool.query('insert into users(id,name,role,shop_id,active,dingtalk_user_id) values($1,$2,$3,$4,$5,$6)',[p.id,p.name,p.role,p.shopId,p.active,`ding-${p.id}`]);
  const db=await import('../server/db.mjs');
  const {reportVehicleLicenseException:report}=await import('../server/services/vehicleLicenseExceptionService.mjs');
  const worker=await import('../server/workers/vehicleLicenseExceptionNotifications.mjs');
  const draft={shop:{id:'shop-hq',name:'抚顺路店'},department:{code:'D',name:'维修部'},vehicle:{plate:'沪ATEST',vin:'LSVNV2182E2123456',mileage:'123',model:'测试车型',modelLegacyCode:'M'},customer:{name:'测试车主',legacyCode:'C',phone:'13800000000'},advisor:advisor.name,oldPartsHandling:'客户带走',inspection:{belongings:[],fuelLevel:'1/2',exteriorIssues:[]},repairItems:[{id:1,name:'保养',status:'待派工'}]};
  let order=await db.createWorkOrder({...draft,vehicleLicenseException:{id:'forged',reason:'绕过'}},advisor.name,advisor);
  assert.equal(order.vehicleLicenseException,undefined,'client-supplied exceptions are ignored');
  const body={reason:'行驶证遗失，客户暂无法提供',requestId:randomUUID(),vehiclePlate:draft.vehicle.plate,vehicleVin:draft.vehicle.vin};
  const options={lookup:async()=>({status:'new'})};
  await assert.rejects(()=>report(advisor,order.id,{...body,reason:' '},options),e=>e.status===400);
  await assert.rejects(()=>report(advisor,order.id,{...body,vehicleVin:'CHANGED'},options),e=>e.status===409);
  for(const p of [others[1],others[2],others[3],others[4]])await assert.rejects(()=>report(p,order.id,body,options),e=>e.status===403);
  // Exception reporting is available regardless of company vehicle lookup status.
  const results=await Promise.all([report(advisor,order.id,body,options),report(advisor,order.id,body,options)]);
  assert.equal(results[0].id,results[1].id);
  assert.equal((await report(advisor,order.id,{...body,requestId:randomUUID()},options)).id,results[0].id);
  order=await db.getWorkOrderDetail(order.id,manager);assert.equal(order.vehicleLicenseException.reason,body.reason);
  assert.equal((await pool.query('select count(*) from vehicle_license_exceptions')).rows[0].count,'1');
  await assert.rejects(()=>report(advisor,order.id,{...body,reason:'不同说明'},options),e=>e.status===409);
  await assert.rejects(()=>db.getWorkOrderDetail(order.id,others[1]),e=>e.status===403);
  await assert.rejects(()=>db.getWorkOrderDetail('missing',manager),e=>e.status===404);
  // Required reception photos still apply; create distinct uploaded files for this order.
  const photos={front45:'front',rear45:'rear'};
  for(const id of Object.values(photos))await pool.query("insert into files(id,order_id,kind,storage_provider,bucket,object_key,original_name,mime_type,size_bytes,uploaded_by) values($1,$2,'repair_order_photo','local','local','test','test.png','image/png',10,$3)",[id,order.id,advisor.id]);
  order=await db.updateWorkOrder({...order,inspection:{...order.inspection,preRepairPhotos:photos}},advisor.name,'保存接车照片',advisor);
  const other=await db.createWorkOrder({...draft,vehicleLicenseException:order.vehicleLicenseException},advisor.name,advisor);
  assert.equal(other.vehicleLicenseException,undefined,'a new order never inherits the exception');
  const signed=await db.createSignatureTokenForOrder(order.id,advisor.name,{signatureMode:'remote'});assert.equal(signed.status,'待客户签字');
  assert.equal((await report(advisor,order.id,{...body,requestId:randomUUID()},options)).id,results[0].id);
  // Unreported missing license must block both onsite and remote signing.
  for(const [key,id] of Object.entries(photos))photos[key]=`other-${id}`;
  for(const id of Object.values(photos))await pool.query("insert into files(id,order_id,kind,storage_provider,bucket,object_key,original_name,mime_type,size_bytes,uploaded_by) values($1,$2,'repair_order_photo','local','local','test','test.png','image/png',10,$3)",[id,other.id,advisor.id]);
  await db.updateWorkOrder({...other,inspection:{...other.inspection,preRepairPhotos:photos}},advisor.name,'接车照片',advisor);
  for(const signatureMode of ['onsite','remote'])await assert.rejects(()=>db.createSignatureTokenForOrder(other.id,advisor.name,{signatureMode}),/行驶证/);
  await Promise.all([worker.resolveLicenseExceptionManagers(),worker.resolveLicenseExceptionManagers()]);
  const targets=(await pool.query('select recipient_id from vehicle_license_exception_notifications order by recipient_id')).rows.map(r=>r.recipient_id);assert.deepEqual(targets,['m1','m2']);
  let sent=0,queried=0;
  const send=async(_n,_recipient,config)=>{sent++;assert.equal(typeof config.buildMessage,'function');return {status:'accepted',taskId:`mock-${sent}`};};
  while(await worker.processLicenseExceptionNotification({send})){}
  assert.equal(sent,2);
  await pool.query('update vehicle_license_exception_notifications set next_attempt_at=now()');
  while(await worker.processLicenseExceptionNotification({send,query:async()=>{queried++;return {status:'sent'};}})){}
  assert.equal(sent,2);assert.equal(queried,2);
  assert.equal((await pool.query("select count(*) from vehicle_license_exception_notifications where status='sent'")).rows[0].count,'2');
  const before=await db.getWorkOrderDetail(order.id,advisor);
  const edited=await db.updateWorkOrder({...before,vehicle:{...before.vehicle,plate:'鲁B862P7',vin:'LZWADAGA8NB072733'}},advisor.name,'待签字修正车辆',advisor);
  const changed={...body,requestId:randomUUID(),vehiclePlate:edited.vehicle.plate,vehicleVin:edited.vehicle.vin};
  const replacement=await report(advisor,order.id,changed,options);
  assert.equal(replacement.vehicleVin,edited.vehicle.vin);assert.notEqual(replacement.id,results[0].id);
  assert.equal((await pool.query('select 1 from legacy_sync_outbox where order_id=$1',[order.id])).rowCount,0);
  const link=await db.createSignatureTokenForOrder(order.id,advisor.name,{signatureMode:'remote'});
  await report(advisor,order.id,{...changed,requestId:randomUUID(),reason:'补充核实证件遗失原因'},options);
  assert.equal(await db.findWorkOrderByToken(link.signatureToken),undefined,'备案内容改变后旧签字链接失效');
  const fresh=await db.createSignatureTokenForOrder(order.id,advisor.name,{signatureMode:'remote'});
  const file=randomUUID();
  await pool.query("insert into files(id,order_id,kind,storage_provider,bucket,object_key,mime_type,size_bytes,uploaded_by) values($1,$2,'signature_image','local','','test','image/png',1,$3)",[file,order.id,advisor.id]);
  await db.signWorkOrderByToken(fresh.signatureToken,'客户',file);
  await assert.rejects(()=>report(advisor,order.id,{...changed,requestId:randomUUID()},options),e=>e.status===409);
  await db.confirmCustomerSignature(order.id,advisor);
  // Submitted orders retain the detail-page photo supplement flow.
  const license=randomUUID();
  await pool.query("insert into files(id,kind,storage_provider,bucket,object_key,mime_type,size_bytes,uploaded_by) values($1,'vehicle_license','local','','test','image/png',1,$2)",[license,advisor.id]);
  const {saveWorkOrderPhoto}=await import('../server/services/workOrderPhotoService.mjs');
  const supplemented=await saveWorkOrderPhoto(order.id,{slot:'vehicleLicense',fileId:license},advisor);
  assert.equal(supplemented.inspection.vehicleLicenseFileId,license);assert.ok(supplemented.files.some(f=>f.id===license));
  assert.equal(supplemented.customerSignatureFileId,file);assert.equal(supplemented.status,'已委托');
  assert.equal((await pool.query('select 1 from legacy_sync_outbox where order_id=$1',[order.id])).rowCount,1);


 } finally {
  if(pool)await pool.end();
  await Promise.all(connectionsClosed);
  await admin.query(`drop database if exists "${name}" with (force)`);await admin.end();
 }
});
