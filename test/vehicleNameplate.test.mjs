import test from 'node:test';
import assert from 'node:assert/strict';
import {assertVehicleNameplate} from '../server/repositories/partsRequirementRepository.mjs';
const task={orderId:'order-a',repairRound:2};
function database(files=[]) {
 return {async query(sql,params) {
  assert.match(sql,/order_id=\$1 and kind='vehicle_nameplate_photo'/);
  assert.deepEqual(params,['order-a']);
  assert.doesNotMatch(sql,/uploaded_by|repair_round/);
  return {rows:files.filter(file=>file.orderId===params[0]&&file.kind==='vehicle_nameplate_photo')};
 }};
}
test('both typed and photo parts requests require a nameplate from the same order',async()=>{
 for(const mode of ['list','photo'])for(const files of [[],[{orderId:'other',kind:'vehicle_nameplate_photo'}],[{orderId:'order-a',kind:'repair_parts_photo'}]]) {
  await assert.rejects(()=>assertVehicleNameplate(database(files),task,{mode}),e=>e.status===400&&/铭牌/.test(e.message));
 }
});
test('a coworkers nameplate is reusable across requests and repair rounds',async()=>{
 const db=database([{id:'plate',orderId:'order-a',kind:'vehicle_nameplate_photo',uploadedBy:'a',repairRound:0}]);
 for(const ownerId of ['a','b'])for(const mode of ['list','photo'])await assertVehicleNameplate(db,task,{mode,ownerId});
});
test('no-parts acceptance does not require a nameplate',async()=>{
 const db={query:()=>assert.fail('must not request a nameplate for no-parts work')};
 await assertVehicleNameplate(db,task,{mode:'none'});
 await assertVehicleNameplate(db,task,undefined);
});
