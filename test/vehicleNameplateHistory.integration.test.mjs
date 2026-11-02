import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
const adminUrl=process.env.DISPATCH_TEST_ADMIN_URL;

test('nameplate history automatically reuses the latest vehicle photo across orders with isolated access and immutable originals',{skip:!adminUrl,timeout:120000},async()=>{
 const url=new URL(adminUrl);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
 const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
 const dbName=`nameplate_history_${process.pid}_${Date.now()}`;let pool;
 try {
  await admin.query(`create database "${dbName}"`);url.pathname=`/${dbName}`;
  process.env.DATABASE_URL=url.toString();process.env.APP_ENV='test';
  pool=(await import('../server/database/pool.mjs')).pool;
  for(const file of (await fs.readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f!=='202608070005_remove_obsolete_runfeng_sync_role.sql').sort())await pool.query(await fs.readFile(`supabase/migrations/${file}`,'utf8'));
  const advisor={id:'advisor',name:'测试顾问',role:'advisor',shopId:'shop-hq',active:true};
  const worker={id:'worker',name:'本次维修工',role:'technician',shopId:'shop-hq',active:true};
  const previousWorker={...worker,id:'previous-worker',name:'上次维修工'};
  for(const actor of [advisor,worker,previousWorker])await pool.query('insert into users(id,name,role,shop_id,active) values($1,$2,$3,$4,true)',[actor.id,actor.name,actor.role,actor.shopId]);
  const db=await import('../server/db.mjs');
  const {ensureVehicleNameplate}=await import('../server/services/vehicleNameplateHistoryService.mjs');
  const {findVehicleNameplateHistory}=await import('../server/repositories/vehicleNameplateHistoryRepository.mjs');
  const history={vehicleNameplateHistory:async(actor,id)=>{const task=await getDispatchTask(pool,id,actor);const source=await findVehicleNameplateHistory(pool,task);return source?{fileId:source.id,matchedBy:task.vehicleVin?'vin':'plate',objectKey:source.object_key}:null;}};
  const {uploadRepairPhoto}=await import('../server/services/repairPhotoService.mjs');
  const {createFileRecord,assertFileReadAccess}=await import('../server/repositories/fileRepository.mjs');
  const {dispatchDetail,getDispatchTask}=await import('../server/repositories/dispatchRepository.mjs');
  const {assertVehicleNameplate}=await import('../server/repositories/partsRequirementRepository.mjs');
  const vin='LZWADAGA8NB072733',plate='鲁BTEST9';
  async function order(actor,identity={vin,plate}) {
   const value=await db.createWorkOrder({advisor:advisor.name,shop:{id:advisor.shopId},vehicle:identity,customer:{name:'历史铭牌测试'},repairItems:[{id:1,name:'检查'}]},advisor.name,advisor);
   await pool.query("update work_orders set status='维修中' where id=$1",[value.id]);
   await pool.query("insert into dispatch_tasks(order_id,shop_id,technician_id,stage,version,data) values($1,'shop-hq',$2,'待开工',1,$3)",[value.id,actor.id,JSON.stringify({technicianIds:[actor.id],items:[{id:1,name:'检查',status:'待开工',responsibleId:actor.id}]})]);
   return value.id;
  }
  let sequence=0;
  async function upload(actor,id) {
   return uploadRepairPhoto(actor,id,{requestId:`upload-photo-${++sequence}`,purpose:'nameplate',repairRound:0,fileName:'铭牌.jpg',mimeType:'image/jpeg',imageBase64:'/9j/2Q=='},{save:input=>createFileRecord({...input,storageProvider:'local',bucket:'',objectKey:`nameplate-test-${sequence}.jpg`,originalName:input.fileName,sizeBytes:4})});
  }
  const first=await order(previousWorker),current=await order(worker),future=await order(worker);
  assert.equal(await history.vehicleNameplateHistory(worker,current),null);
  const original=await upload(previousWorker,first);
  await pool.query("update files set nameplate_recorded_at='2026-10-01' where id=$1",[original.id]);
  assert.equal((await history.vehicleNameplateHistory(worker,current)).fileId,original.id);
  await assert.rejects(()=>assertFileReadAccess(original.id,worker),e=>e.status===403);
  await assert.rejects(()=>history.vehicleNameplateHistory({...worker,shopId:'other'},current),e=>e.status===403);
  await assert.rejects(()=>history.vehicleNameplateHistory(previousWorker,current),e=>e.status===403);
  const body={requestId:'reuse-history-001',repairRound:0};
  await assert.rejects(()=>ensureVehicleNameplate(advisor,current,body),e=>e.status===403);
  await assert.rejects(()=>ensureVehicleNameplate(worker,current,{...body,repairRound:1}),e=>e.status===409);
  const [reused,duplicate]=await Promise.all([ensureVehicleNameplate(worker,current,body),ensureVehicleNameplate(worker,current,body)]);
  assert.deepEqual(reused,duplicate);assert.notEqual(reused.id,original.id);
  const copies=(await pool.query('select * from files where id=any($1::text[])',[[original.id,reused.id]])).rows;
  const source=copies.find(f=>f.id===original.id),copy=copies.find(f=>f.id===reused.id);
  assert.equal(source.order_id,first);assert.equal(copy.order_id,current);assert.equal(copy.object_key,source.object_key);
  assert.equal(copy.nameplate_source_file_id,original.id);assert.equal(copy.nameplate_recorded_at.toISOString(),source.nameplate_recorded_at.toISOString());
  await assertFileReadAccess(reused.id,worker);
  const detail=await dispatchDetail(worker,current);
  assert.equal(detail.task.vehicleNameplateFileId,reused.id);assert.equal(detail.files.find(f=>f.id===reused.id).nameplateSourceFileId,original.id);
  assert.equal(detail.events[0].action,'vehicle-nameplate-reuse');
  await assertVehicleNameplate(pool,detail.task,{mode:'list'});await assertVehicleNameplate(pool,detail.task,{mode:'photo'});
  assert.equal((await ensureVehicleNameplate(worker,current,{...body,requestId:'reuse-history-002'})).id,reused.id,'opening the workflow again keeps the current image');
  const replacement=await upload(worker,current);
  assert.equal((await dispatchDetail(worker,current)).task.vehicleNameplateFileId,replacement.id);
  assert.equal((await dispatchDetail(previousWorker,first)).task.vehicleNameplateFileId,original.id);
  assert.equal((await history.vehicleNameplateHistory(worker,future)).fileId,replacement.id);
  const auto=await ensureVehicleNameplate(worker,future,body);
  assert.equal((await pool.query('select nameplate_source_file_id from files where id=$1',[auto.id])).rows[0].nameplate_source_file_id,replacement.id,'a new visit automatically uses the replacement');
  assert.equal((await ensureVehicleNameplate(worker,current,body)).id,replacement.id,'initialization never restores an older photo over a fresh upload');
  // A new plate for the same VIN still finds the saved nameplate; a conflicting VIN never does.
  const changedPlate=await order(worker,{vin:vin.toLowerCase(),plate:'鲁BNEW99'});
  assert.equal((await history.vehicleNameplateHistory(worker,changedPlate)).objectKey,(await history.vehicleNameplateHistory(worker,future)).objectKey);
  const otherVehicle=await order(worker,{vin:'LZWADAGA8NB072734',plate});
  assert.equal(await history.vehicleNameplateHistory(worker,otherVehicle),null);
  assert.deepEqual(await ensureVehicleNameplate(worker,otherVehicle,body),{id:null},'no matching history leaves the camera flow available');
  const noVin=await order(worker,{vin:'',plate:'鲁 BTEST9'});
  assert.equal((await history.vehicleNameplateHistory(worker,noVin)).matchedBy,'plate');
  const malformed=await order(worker,{vin:'INVALID',plate});
  assert.equal(await history.vehicleNameplateHistory(worker,malformed),null);
  await upload(worker,otherVehicle);
  assert.equal(await history.vehicleNameplateHistory(worker,noVin),null,'same plate with conflicting historical VINs is ambiguous');
  // Identity is captured at upload, rather than following later edits to the old order.
  await pool.query("update work_orders set vehicle_vin='LZWADAGA8NB072735' where id=$1",[current]);
  assert.equal((await history.vehicleNameplateHistory(worker,future)).fileId,replacement.id);
  // No reassigned, completed, stale-round, or inactive worker can reuse a photo.
  await pool.query("update dispatch_tasks set stage='待检验' where order_id=$1",[future]);
  await assert.rejects(()=>ensureVehicleNameplate(worker,future,{...body,fileId:replacement.id}),e=>e.status===409);
  await pool.query("update dispatch_tasks set stage='待开工',data=data||$2::jsonb where order_id=$1",[future,JSON.stringify({technicianIds:[worker.id,previousWorker.id],items:[{id:1,name:'检查',status:'待检验',responsibleId:worker.id}],workerSubmissions:{worker:{at:'2026-11-02'}}})]);
  await assert.rejects(()=>ensureVehicleNameplate(worker,future,{...body,fileId:replacement.id}),e=>e.status===409);
  await pool.query("update users set active=false where id='worker'");
  await assert.rejects(()=>ensureVehicleNameplate(worker,changedPlate,{...body,fileId:replacement.id}),e=>e.status===403);
  assert.ok(await getDispatchTask(pool,current,advisor));
 } finally {
  if(pool)await pool.end();await admin.query(`drop database if exists "${dbName}" with (force)`);await admin.end();
 }
});
