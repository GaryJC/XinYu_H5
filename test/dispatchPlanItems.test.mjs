import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPlannedResponsibilities} from '../server/domain/dispatchPlanItems.mjs';
const items=[{id:10,name:'同名项目'},{id:20,name:'同名项目'}];
test('direct dispatch matches stable IDs, not names or positions',()=>{
 const result=applyPlannedResponsibilities(items,[{itemId:20,technicianId:'b'},{itemId:10,technicianId:'a'}]);
 assert.deepEqual(result.map(item=>item.responsibleId),['a','b']);
 assert.equal(items[0].responsibleId,undefined);
});
test('direct dispatch rejects missing, duplicate, removed and malformed assignments',()=>{
 for(const rows of [null,[],[{itemId:10,technicianId:'a'}],[{itemId:10,technicianId:'a'},{itemId:10,technicianId:'b'}],[{itemId:10,technicianId:'a'},{itemId:30,technicianId:'b'}],[{itemId:10,technicianId:'a'},{itemId:20,technicianId:''}]]) assert.throws(()=>applyPlannedResponsibilities(items,rows),error=>error.status===400);
 assert.throws(()=>applyPlannedResponsibilities([],[]),error=>error.status===400);
});
