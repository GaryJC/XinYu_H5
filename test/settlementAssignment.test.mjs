import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDispatchAction} from '../server/domain/dispatchPolicy.mjs';
const a={id:'a',name:'甲',role:'technician',shopId:'s',active:true},b={...a,id:'b'},c={...a,id:'c'},advisor={...a,id:'s',role:'advisor'},inspector={...a,id:'i',role:'inspector'};
const people=[a,b,c,advisor,inspector];
const task=()=>({orderId:'o',shopId:'s',stage:'维修完成',orderStatus:'待结算',version:1,technicianIds:['a','b'],technicianId:'a',completedAt:'old',inspectorId:'i',workHours:3,workerSubmissions:{a:{at:'old'},b:{at:'old'}},items:[a,b].map((p,index)=>({id:index+1,name:`项目${index+1}`,responsibleId:p.id,responsibleName:p.name,status:'已完工',startAt:'old',startedBy:p.id,finishAt:'old',finishedBy:p.id,inspectedAt:'old',inspectedBy:'i',inspectorName:'检验员'}))});
const act=(t,actor,action,extra={},roster=people)=>applyDispatchAction(t,{action,expectedVersion:t.version,requestId:'settlement-test',...extra},actor,roster);
const originalRows=t=>t.items.map(({id,name,responsibleId})=>({id,name,responsibleId}));
const rows=t=>[...originalRows(t),{name:'新增检查',responsibleId:'c'}];
test('settlement addition preserves every inspected project and completes through inspection',()=>{
 const original={...task(),technicianIds:['a','b','unused']};let t=act(original,advisor,'edit-repair-items',{repairItems:rows(original)});
 assert.equal(t.technicianIds.includes('unused'),false);
 assert.equal(t.stage,'维修中');assert.equal(t.orderStatus,'维修中');assert.equal(t.items[2].status,'待开工');
 assert.deepEqual(t.items.slice(0,2),original.items);assert.equal(t.completedAt,undefined);assert.equal(t.workHours,undefined);
 assert.equal(t.items[2].inspectedAt,undefined);
 assert.throws(()=>act(t,c,'submit-order'),e=>e.status===409);
 t=act(t,c,'start-order');t=act(t,c,'submit-order');t=act(t,inspector,'claim-inspection');t=act(t,inspector,'inspect');
 assert.equal(t.stage,'维修完成');assert.equal(original.stage,'维修完成');
});
test('settlement reassignment rejects invalid owners, closed orders and ordinary workers',()=>{
 for(const patch of [{orderStatus:'完成'}]){const t={...task(),...patch};assert.throws(()=>act(t,advisor,'edit-repair-items',{repairItems:rows(t)}));}
 const t=task(),before=structuredClone(t);
 assert.throws(()=>act(t,a,'edit-repair-items',{repairItems:rows(t),reason:'换人'}));
 for(const patch of [{active:false},{shopId:'other'},{role:'advisor'}])assert.throws(()=>act(t,advisor,'edit-repair-items',{repairItems:rows(t),reason:'换人'},[a,b,{...c,...patch},advisor,inspector]));
 assert.deepEqual(t,before);
});
test('review edits are limited to the assigned worker and their own projects',()=>{
 const original={...task(),stage:'回审',items:task().items.map((item,index)=>({...item,status:index?'待检验':'维修中'}))};
 for(const role of ['advisor','manager'])for(const repairItems of [originalRows(original)]) {
  assert.throws(()=>act(original,{...advisor,role},'edit-repair-items',{repairItems}),e=>e.status===403);
 }
 const t=act(original,a,'edit-repair-items',{repairItems:[{id:1,name:'本人项目修改',responsibleId:'a'}]});
 assert.equal(t.stage,'回审');assert.equal(t.items[0].name,'本人项目修改');assert.deepEqual(t.items[1],original.items[1]);
 assert.throws(()=>act(original,a,'edit-repair-items',{repairItems:originalRows(original)}),e=>e.status===403);
});
test('settlement permits new assigned work but does not unlock completed names or deletion',()=>{
 const t=task(),originalRows=t.items.map(({id,name,responsibleId})=>({id,name,responsibleId}));
 const next=act(t,advisor,'edit-repair-items',{repairItems:[...originalRows,{name:'新增检查',responsibleId:'c'}],reason:'补充任务'});
 assert.equal(next.stage,'维修中');assert.equal(next.items[2].status,'待开工');assert.deepEqual(next.items.slice(0,2),t.items);
 for(const repairItems of [rows(t).slice(0,1),rows(t).map(row=>({...row,name:'改名'})),rows(t).map(row=>({...row,responsibleId:'c'})),originalRows])assert.throws(()=>act(t,advisor,'edit-repair-items',{repairItems,reason:'变更'}));
});

test('inspected projects stay immutable even when submitted together with valid new work',()=>{
 for(const stage of ['维修完成','回审'])for(const mutation of ['owner','name','remove']) {
  const t={...task(),stage},before=structuredClone(t);
  let edits=rows(t);
  if(mutation==='owner')edits[0].responsibleId='c';
  if(mutation==='name')edits[0].name='篡改名称';
  if(mutation==='remove')edits=edits.slice(1);
  assert.throws(()=>act(t,advisor,'edit-repair-items',{repairItems:edits,reason:'新增任务'}),e=>e.status===(stage==='回审'&&mutation==='remove'?403:409));
  assert.deepEqual(t,before);
 }
});

test('settlement additions to an original worker require a new start and preserve original inspections',()=>{
 for(const worker of [a,b]) {
  const original=task();
  let t=act(original,advisor,'edit-repair-items',{repairItems:[...originalRows(original),{name:'本人追加检查',responsibleId:worker.id}]});
  assert.throws(()=>act(t,worker,'submit-order'),e=>e.status===409);
  const edited=t.items.map(({id,name,responsibleId})=>({id,name,responsibleId}));
  edited[0].responsibleId='c';
  assert.throws(()=>act(t,advisor,'edit-repair-items',{repairItems:edited}),e=>e.status===409,'退回维修后仍不可改派原已检验项目');
  t=act(t,worker,'start-order');t=act(t,worker,'submit-order');
  assert.deepEqual(t.items.slice(0,2),original.items);
  t=act(t,inspector,'claim-inspection');t=act(t,inspector,'inspect');
  assert.equal(t.stage,'维修完成');assert.deepEqual(t.items.slice(0,2),original.items);
 }
});
