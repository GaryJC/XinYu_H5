import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {applyDispatchAction} from '../server/domain/dispatchPolicy.mjs';
const a={id:'a',name:'甲',role:'technician',shopId:'s',active:true};
const b={...a,id:'b',name:'乙'},inspector={...a,id:'i',role:'inspector'},advisor={...a,id:'d',role:'advisor'},manager={...a,id:'m',role:'manager'};
const people=[a,b,inspector,advisor,manager];
const run=(task,actor,action,extra={})=>applyDispatchAction(task,{action,expectedVersion:task.version,requestId:randomUUID(),...extra},actor,people);
const base=status=>({orderId:'matrix',shopId:'s',orderStatus:'维修中',stage:'回审',version:4,technicianId:a.id,technicianIds:[a.id],acceptedAt:'old',partsRequirement:{mode:'none'},items:[{id:1,name:'原项目',responsibleId:a.id,responsibleName:a.name,status,startAt:'old',...(status==='已完工'?{inspectedBy:inspector.id,inspectedAt:'old'}:{})}]});
for(const actor of [advisor,manager])for(const executionMode of ['internal','offsite'])for(const status of ['维修中','待检验','已完工'])for(const owner of [a,b]) {
 test(`${actor.role}/${executionMode}/${status}/增项给${owner.name}: preserves old work and completes inspection`,()=>{
  const original={...base(status),executionMode},snapshot=structuredClone(original);
  let t=run(original,actor,'edit-repair-items',{repairItems:[{id:1,name:'原项目',responsibleId:a.id},{name:'新增检查',responsibleId:owner.id}]});
  assert.deepEqual(original,snapshot);assert.deepEqual(t.items[0],snapshot.items[0]);assert.equal(t.stage,'回审');assert.equal(t.items[1].status,'待开工');
  assert.throws(()=>run(t,owner,'submit-review'),e=>e.status===409);
  t=run(t,owner,'start-order');t=run(t,owner,'submit-review');
  assert.throws(()=>run(t,owner,'submit-review'),e=>e.status===409);
  if(owner.id!==a.id&&status==='维修中')t=run(t,a,'submit-review');
  t=run(t,inspector,'claim-inspection');t=run(t,inspector,'inspect');
  assert.equal(t.stage,'维修完成');assert.ok(t.items.every(item=>item.status==='已完工'));
  if(status==='已完工')assert.deepEqual(t.items[0],snapshot.items[0]);
 });
}
test('review addition rejects malformed and stale requests without mutating the task',()=>{
 const original=base('待检验'),snapshot=structuredClone(original);
 const rows=[{id:1,name:'原项目',responsibleId:a.id},{name:'新增',responsibleId:b.id}];
 for(const repairItems of [[],[rows[0],rows[0],rows[1]],[...rows,{id:999,name:'伪造项目',responsibleId:b.id}],[rows[0],{name:'新增'}],[rows[0],{name:'  ',responsibleId:b.id}],[rows[0],{name:'x'.repeat(201),responsibleId:b.id}]])assert.throws(()=>run(original,advisor,'edit-repair-items',{repairItems}));
 assert.throws(()=>run(original,advisor,'edit-repair-items',{repairItems:rows,expectedVersion:3}),e=>e.status===409);
 assert.throws(()=>run(original,{...advisor,shopId:'other'},'edit-repair-items',{repairItems:rows}),e=>e.status===403);
 assert.throws(()=>run(original,{...advisor,active:false},'edit-repair-items',{repairItems:rows}),e=>e.status===403);
 assert.deepEqual(original,snapshot);
});
test('repeated review additions allocate distinct ids and preserve an independent active inspection claim',()=>{
 let t={...base('待检验'),inspectorId:inspector.id,inspectorName:inspector.name,inspectionClaimedAt:'claim',repairItemIdFloor:-90};
 for(let n=0;n<3;n++) {
  const before=structuredClone(t.items);
  t=run(t,advisor,'edit-repair-items',{repairItems:[...t.items.map(({id,name,responsibleId})=>({id,name,responsibleId})),{name:`新增${n}`,responsibleId:b.id}]});
  assert.deepEqual(t.items.slice(0,-1),before);assert.equal(t.inspectorId,inspector.id);assert.equal(t.inspectionClaimedAt,'claim');
 }
 assert.equal(new Set(t.items.map(i=>i.id)).size,4);assert.ok(t.items.slice(1).every(i=>i.id < -90));
});
test('review additions enforce the 200-project limit and ignore forged progress fields',()=>{
 const original=base('已完工');
 const rows=[{id:1,name:'原项目',responsibleId:a.id},...Array.from({length:199},(_,i)=>({name:`新增${i}`,responsibleId:b.id,status:'已完工',startAt:'forged',inspectedAt:'forged',inspectedBy:'i'}))];
 const next=run(original,advisor,'edit-repair-items',{repairItems:rows});
 assert.equal(next.items.length,200);assert.equal(new Set(next.items.map(i=>i.id)).size,200);
 assert.ok(next.items.slice(1).every(i=>i.status==='待开工'&&!i.startAt&&!i.inspectedAt&&!i.inspectedBy));
 assert.throws(()=>run(original,advisor,'edit-repair-items',{repairItems:[...rows,{name:'超限',responsibleId:b.id}]}),e=>e.status===400);
});
test('adding work to a paused review worker preserves their pause and requires resume before start',()=>{
 let t={...base('维修中'),technicianIds:[a.id,b.id],workerPauses:{a:{pauseReason:'技术问题',pausedAt:'old',resumeStage:'维修中'}},items:[...base('维修中').items,{id:2,name:'乙项目',status:'维修中',responsibleId:b.id,startAt:'old'}]};
 t=run(t,advisor,'edit-repair-items',{repairItems:[...t.items.map(({id,name,responsibleId})=>({id,name,responsibleId})),{name:'甲新增',responsibleId:a.id}]});
 assert.equal(t.workerPauses.a.pausedAt,'old');
 assert.throws(()=>run(t,a,'start-order'),e=>e.status===409);
 assert.throws(()=>run(t,a,'submit-review'),e=>e.status===409);
 t=run(t,a,'resume');assert.equal(t.stage,'回审');assert.equal(t.workerPauses.a,undefined);
 t=run(t,a,'start-order');assert.equal(t.stage,'回审');assert.equal(t.items[2].status,'维修中');
});
