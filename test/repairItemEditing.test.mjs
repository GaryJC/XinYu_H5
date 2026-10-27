import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDispatchAction} from '../server/domain/dispatchPolicy.mjs';
const tech={id:'t',name:'维修工',role:'technician',active:true,shopId:'s'};
const task=()=>({orderId:'o',shopId:'s',orderStatus:'维修中',technicianIds:['t'],stage:'维修中',version:1,items:[{id:1,name:'原项目',status:'维修中',startAt:'old',startedBy:'t'},{id:2,name:'已检验项目',responsibleId:'t',responsibleName:'维修工',status:'已完工',inspectedBy:'i',finishAt:'old'}]});
const act=(t,repairItems,action='edit-repair-items',actor=tech)=>applyDispatchAction(t,{action,repairItems,expectedVersion:t.version,requestId:'edit-test-request'},actor,[tech],'2026-10-18T05:00:00Z');
const rows=()=>[{id:1,name:' 修正项目 '},{id:2,name:'已检验项目'},{name:'增修项目'}];
test('technicians rename and add items while preserving progress and original input',()=>{
 const t=task(),before=structuredClone(t),next=act(t,rows());
 assert.deepEqual(t,before);assert.equal(next.items[0].name,'修正项目');assert.equal(next.items[0].startAt,'old');
 assert.deepEqual(next.items[1],t.items[1]);assert.equal(next.items[2].id,-1);assert.equal(next.items[2].status,'维修中');assert.equal(next.items[2].startedBy,'t');
 const waiting={...t,stage:'待开工'};assert.equal(act(waiting,rows()).items[2].status,'待开工');
 const paused={...t,stage:'暂停',resumeStage:'维修中'};assert.equal(act(paused,rows()).stage,'暂停');
});
test('item editing enforces ownership, allowed stages, retained IDs and inspection locks',()=>{
 const t=task();
 for(const actor of [{...tech,id:'other'},{...tech,role:'warehouse'},{...tech,shopId:'other'}])assert.throws(()=>act(t,rows(),'edit-repair-items',actor),e=>e.status===403);
 for(const stage of ['待接单','待检验','维修完成'])assert.throws(()=>act({...t,stage},rows()),e=>e.status===409);
 assert.throws(()=>act(t,[{id:1,name:'项目'}]),e=>e.status===403);
 assert.throws(()=>act(t,[...rows(),{id:99,name:'伪造项目'}]),/不存在/);
 assert.throws(()=>act(t,[{id:1,name:'项目'},{id:2,name:'改动已检验'}]),/不可修改/);
 for(const invalid of [[],[{name:''}],Array(201).fill({name:'项目'}),[{id:1,name:'a'},{id:1,name:'b'}]])assert.throws(()=>act(t,invalid),e=>e.status===400);
});
test('completion applies item edits atomically without allowing waiting work to finish',()=>{
 const t=task(),next=act(t,rows(),'submit-order');assert.equal(next.stage,'待检验');assert.equal(next.items[2].status,'待检验');assert.equal(next.items[2].finishedBy,'t');
 assert.deepEqual(next.items[1],t.items[1]);
 assert.throws(()=>act({...t,stage:'待开工'},rows(),'submit-order'),/当前待开工/);
 const withParts={...t,partsRequirement:{mode:'list'}};assert.throws(()=>act(withParts,rows(),'submit-order'),/备齐/);
 assert.throws(()=>act(t,rows(),'pause'),e=>e.status===400);
});
test('new IDs never reuse previous repair round IDs and do not change closed snapshots',()=>{
 const t={...task(),repairRound:2,repairCatalog:[{id:1},{id:2},{id:-4}]},before=structuredClone(t);
 assert.equal(act(t,rows()).items[2].id,-5);assert.deepEqual(t,before);
});
test('repair item names accept 100 characters and reject 101 before saving or submitting',()=>{
 for(const action of ['edit-repair-items','submit-order','submit-review']) {
  const t={...task(),stage:action==='submit-review'?'回审':'维修中'};
  for(const character of ['修','a']) {
   const edits=[{id:1,name:character.repeat(100)},{id:2,name:'已检验项目'}];
   assert.equal(act(t,edits,action).items[0].name.length,100);
   const before=structuredClone(t);
   edits[0].name+=character;
   assert.throws(()=>act(t,edits,action),e=>e.status===400&&/100/.test(e.message));
   assert.deepEqual(t,before);
  }
 }
});
test('completion cannot bypass name validation by omitting the edits payload',()=>{
 const t=task();t.items[0].name='修'.repeat(101);
 assert.throws(()=>act(t,undefined,'submit-order'),e=>e.status===400&&/100/.test(e.message));
 assert.throws(()=>applyDispatchAction(t,{action:'finish',itemId:1,expectedVersion:t.version,requestId:'long-name-finish'},tech,[tech]),e=>e.status===400&&/100/.test(e.message));
 assert.equal(t.items[0].status,'维修中');
});
