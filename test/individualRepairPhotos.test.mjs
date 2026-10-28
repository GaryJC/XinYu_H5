import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
const {uploadRepairPhoto}=await import('../server/services/repairPhotoService.mjs');
const {removeRepairPhotos}=await import('../server/repositories/repairPhotoRepository.mjs');
const actor={id:'a',name:'甲',role:'technician',shopId:'s',active:true};
const body={requestId:'individual-photo-test',mimeType:'image/png',imageBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII='};
function database(ownStatus,{existing=false,legacy=false,kind='repair_progress_photo'}={}) {
 const calls=[];
 return {calls,async query(sql,params) {
  calls.push({sql,params});
  if(sql.includes('from work_orders wo left join dispatch_tasks'))return {rows:[{order_id:'o',shop_id:'s',order_status:'维修中',stage:'维修中',version:1,data:{technicianIds:['a','b'],workerSubmissions:legacy||!ownStatus?undefined:{a:{at:'submitted'}},items:[...(ownStatus?[{id:1,responsibleId:'a',status:ownStatus}]:[]),{id:2,responsibleId:'b',status:'维修中'}]},repair_items:[]}]};
  if(sql.includes('select role,active,shop_id'))return {rows:[{role:'technician',active:true,shop_id:'s'}]};
  if(sql.includes('upload_request_id'))return {rows:existing?[{id:'photo',kind,repair_round:0}]:[]};
  if(sql.includes('id<>$2'))return {rows:[]};
  if(sql.startsWith('insert into dispatch_events'))return {rows:[{id:12}]};
  if(sql.startsWith('select id from files')||sql.startsWith('delete from files'))return {rows:[{id:'photo'}]};
  return {rows:[]};
 }};
}
test('submitted worker cannot upload new progress or parts photos while peers continue',async()=>{
 for(const status of ['待检验','已完工'])for(const purpose of ['progress','parts','completed','nameplate']) {
  const db=database(status);let saves=0;
  await assert.rejects(()=>uploadRepairPhoto(actor,'o',{...body,purpose},{runTransaction:fn=>fn(db),save:async()=>{saves++;return {id:'new'};}}),e=>e.status===409);
  assert.equal(saves,0);
 }
});
test('same photo retry remains idempotent after personal submission',async()=>{
 const db=database('待检验',{existing:true});
 const result=await uploadRepairPhoto(actor,'o',body,{runTransaction:fn=>fn(db),save:async()=>assert.fail('must not save twice')});
 assert.equal(result.id,'photo');
});
test('worker awaiting project assignment can remove their mistaken current-round photo',async()=>{
 const db=database(undefined);
 assert.deepEqual(await removeRepairPhotos(db,actor,'o',['photo']),{ids:['photo']});
 assert.ok(db.calls.some(c=>c.sql.startsWith('delete from files')));
 assert.equal(db.calls.find(c=>c.sql.startsWith('delete from files')).params[3],actor.id);
});

test('legacy item completions without personal submission can still upload required evidence',async()=>{
 const db=database('待检验',{legacy:true});let saves=0;
 const result=await uploadRepairPhoto(actor,'o',body,{runTransaction:fn=>fn(db),save:async()=>{saves++;return {id:'new'};}});
 assert.equal(result.id,'new');assert.equal(saves,1);
});

test('legacy item completion permits replacing a mistaken photo before personal submission',async()=>{
 const db=database('待检验',{legacy:true});
 assert.deepEqual(await removeRepairPhotos(db,actor,'o',['photo']),{ids:['photo']});
 assert.ok(db.calls.some(call=>call.sql.startsWith('delete from files')));
});


test('completion photo stores a distinct kind and remains in the current repair round',async()=>{
 const db=database('维修中',{legacy:true});let saved;
 const result=await uploadRepairPhoto(actor,'o',{...body,purpose:'completed'},{runTransaction:fn=>fn(db),save:async input=>{saved=input;return {id:'completed'};}});
 assert.equal(saved.kind,'repair_completed_photo');assert.equal(result.repairRound,0);
});

test('vehicle nameplate upload uses a dedicated kind without counting as completion evidence',async()=>{
 const db=database('维修中',{legacy:true});let saved;
 const result=await uploadRepairPhoto(actor,'o',{...body,purpose:'nameplate'},{runTransaction:fn=>fn(db),save:async input=>{saved=input;return {id:'nameplate'};}});
 assert.equal(saved.kind,'vehicle_nameplate_photo');assert.equal(saved.orderId,'o');assert.equal(saved.uploadedBy,actor.id);assert.equal(result.id,'nameplate');
});

test('retrying a committed nameplate upload does not create another event or notice',async()=>{
 const db=database('待检验',{existing:true,kind:'vehicle_nameplate_photo'});
 const result=await uploadRepairPhoto(actor,'o',{...body,purpose:'nameplate'},{runTransaction:fn=>fn(db),save:async()=>assert.fail('duplicate upload')});
 assert.equal(result.id,'photo');
 assert.ok(!db.calls.some(call=>call.sql.startsWith('insert into dispatch_events')||call.sql.startsWith('insert into dispatch_notifications')));
});
