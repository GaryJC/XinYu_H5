import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDispatchAction} from '../server/domain/dispatchPolicy.mjs';
const a={id:'a',name:'甲',role:'technician',shopId:'s',active:true};
const b={...a,id:'b',name:'乙'},c={...a,id:'c',name:'丙'};
const inspector={...a,id:'i',role:'inspector'},otherInspector={...inspector,id:'j'};
const manager={...a,id:'m',role:'manager'};
const people=[a,b,c,inspector,otherInspector,manager];
const base=()=>({orderId:'o',shopId:'s',orderStatus:'维修中',stage:'维修中',version:1,acceptedAt:'accepted',technicianIds:['a','b'],technicianId:'a',items:[{id:1,name:'甲项目',responsibleId:'a',status:'维修中',startedBy:'a',startAt:'started'},{id:2,name:'乙项目',responsibleId:'b',status:'维修中',startedBy:'b',startAt:'started'}]});
const act=(task,actor,action,extra={})=>applyDispatchAction(task,{action,expectedVersion:task.version,requestId:'transition-regression',...extra},actor,people,'2026-10-26T01:00:00Z');

test('another inspector cannot submit a claimed partial inspection without explicit handover',()=>{
 let task=act(base(),a,'submit-order');
 task=act(task,inspector,'claim-inspection');
 for(const extra of [{},{rejectedItemIds:[1],reason:'退回'}])assert.throws(()=>act(task,otherInspector,'inspect',extra),e=>e.status===403);
 task=act(task,inspector,'reassign-inspection',{inspectorId:otherInspector.id,reason:'交班'});
 assert.throws(()=>act(task,inspector,'inspect'),e=>e.status===403);
 assert.equal(act(task,otherInspector,'inspect').items[0].status,'已完工');
 assert.equal(act(task,manager,'inspect').items[0].status,'已完工');
});

test('partial inspection rejection during review keeps coworkers in the review workflow',()=>{
 let task=base();task.stage='回审';
 task=act(task,a,'submit-review');
 task=act(task,inspector,'claim-inspection');
 task=act(task,inspector,'inspect',{rejectedItemIds:[1],reason:'补修'});
 assert.equal(task.stage,'回审');assert.equal(task.items[0].status,'待开工');
 assert.equal(task.items[1].status,'维修中');
 task=act(task,b,'submit-review');assert.equal(task.stage,'回审');
 task=act(task,a,'start-order');assert.equal(task.stage,'回审');
 task=act(task,a,'submit-review');assert.equal(task.stage,'待检验');
});

test('whole-team reassignment resets personal pauses so retained workers can accept the new assignment',()=>{
 let task=act(base(),a,'pause',{pauseReason:'技术问题'});
 task=act(task,manager,'reassign',{technicianIds:['a','c'],reason:'重新分工',dueAt:'2026-10-27T00:00:00Z',repairItems:[{id:1,name:'甲项目',responsibleId:'a'},{id:2,name:'乙项目',responsibleId:'c'}]});
 assert.equal(task.stage,'待接单');assert.equal(task.workerPauses?.a,undefined);
 task=act(task,a,'accept',{partsRequirement:{mode:'none'}});
 assert.equal(task.acceptedAt,'2026-10-26T01:00:00Z');
});

for(const stage of ['维修中','回审'])test(`bounded interleaving exploration preserves ownership and lifecycle from ${stage}`,t=>{
 const initial={...base(),stage};
 const queue=[{task:initial,depth:0}],seen=new Set();
 let attempts=0,accepted=0;
 for(let cursor=0;cursor<queue.length;cursor++) {
  const {task,depth}=queue[cursor];if(depth===6)continue;
  const actions=[...[a,b].flatMap(actor=>[
   {actor,action:'pause',extra:{pauseReason:'技术问题'}},{actor,action:'resume'},
   {actor,action:'start-order'},{actor,action:task.stage==='回审'?'submit-review':'submit-order'}
  ]),{actor:inspector,action:'claim-inspection'},{actor:inspector,action:'inspect'},
   ...task.items.filter(i=>i.status==='待检验').map(item=>({actor:inspector,action:'inspect',extra:{rejectedItemIds:[item.id],reason:'复查'}}))];
  for(const {actor,action,extra} of actions) {
   attempts++;const before=structuredClone(task);let next;
   try {next=act(task,actor,action,extra);} catch(error) {
    assert.ok([400,403,409].includes(error.status),`${action}: unexpected ${error.stack}`);
    assert.deepEqual(task,before);continue;
   }
   accepted++;assert.deepEqual(task,before);assert.equal(next.version,task.version+1);
   assert.equal(new Set(next.items.map(item=>item.id)).size,next.items.length);
   if(actor.role==='technician') {
    assert.deepEqual(next.items.filter(i=>i.responsibleId!==actor.id),task.items.filter(i=>i.responsibleId!==actor.id));
    const other=actor.id==='a'?'b':'a';assert.deepEqual(next.workerPauses?.[other],task.workerPauses?.[other]);
   }
   if(next.stage==='维修完成')assert.ok(next.items.every(i=>i.status==='已完工'));
   if(task.stage==='回审'&&next.stage!=='待检验'&&next.stage!=='维修完成')assert.equal(next.stage,'回审');
   const {version,...state}=next,key=JSON.stringify(state);
   if(!seen.has(key)){seen.add(key);queue.push({task:next,depth:depth+1});}
  }
 }
 assert.ok(attempts>100);assert.ok(accepted>30);
 t.diagnostic(`${attempts} attempted transitions, ${accepted} accepted, ${seen.size} unique resulting states (depth 6)`);
});

test('selective project reassignment preserves an unrelated workers personal pause',()=>{
 const task=act(base(),a,'pause',{pauseReason:'技术问题'});
 const next=act(task,manager,'reassign',{reassignItemIds:[2],repairItems:[{id:2,name:'乙项目',responsibleId:'c'}],reason:'项目交接'});
 assert.deepEqual(next.workerPauses.a,task.workerPauses.a);
 assert.deepEqual(next.items[0],task.items[0]);
 assert.throws(()=>act(next,a,'submit-order'),/暂停/);
});
for(const route of ['reassign','edit-repair-items'])test(`${route} removes a departed worker pause without resurrecting it on later reassignment`,()=>{
 let task=act(base(),a,'pause',{pauseReason:'技术问题'});
 task=act(task,b,'pause',{pauseReason:'待配件'});
 const otherPause=structuredClone(task.workerPauses.b);
 const move=(current,owner)=>act(current,manager,route,{reason:'项目交接',...(route==='reassign'?{reassignItemIds:[1]}:{}),repairItems:(route==='reassign'?current.items.filter(item=>item.id===1):current.items).map(item=>({id:item.id,name:item.name,responsibleId:item.id===1?owner:item.responsibleId}))});
 task=move(task,'c');
 assert.equal(task.technicianIds.includes('a'),false);
 assert.equal(task.workerPauses?.a,undefined);
 assert.deepEqual(task.workerPauses.b,otherPause);
 task=move(task,'a');
 task=act(task,a,'submit-order');
 assert.equal(task.items[0].status,'待检验');assert.deepEqual(task.workerPauses.b,otherPause);
});
test('a paused worker remains blocked when reassignment reduces the team to one person',()=>{
 let task=act(base(),b,'pause',{pauseReason:'技术问题'});
 task=act(task,manager,'reassign',{reason:'合并项目',reassignItemIds:[1],repairItems:[{id:1,name:'甲项目',responsibleId:'b'}]});
 assert.deepEqual(task.technicianIds,['b']);
 assert.throws(()=>act(task,b,'submit-order'),e=>e.status===409);
 task=act(task,b,'resume');
 task=act(task,b,'submit-order');
 assert.equal(task.stage,'待检验');
});
