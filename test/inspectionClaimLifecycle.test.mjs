import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDispatchAction} from '../server/domain/dispatchPolicy.mjs';
const tech={id:'t',name:'技师',role:'technician',shopId:'s',active:true};
const inspector={...tech,id:'i',name:'检验员',role:'inspector'},other={...inspector,id:'j'};
const people=[tech,inspector,other];
const task=()=>({orderId:'o',shopId:'s',orderStatus:'维修中',stage:'维修中',version:1,technicianIds:['t'],technicianId:'t',items:[1,2].map(id=>({id,name:`项目${id}`,status:'维修中',responsibleId:'t',startedBy:'t',startAt:'started'}))});
const act=(t,actor,action,extra={})=>applyDispatchAction(t,{action,expectedVersion:t.version,requestId:'claim-lifecycle',...extra},actor,people,'2026-10-26T08:00:00Z');
function claimed(){let t=act(task(),tech,'finish',{itemId:1});return act(t,inspector,'claim-inspection');}
test('single-worker final submission preserves an active partial inspection claim',()=>{
 const original=claimed(),next=act(original,tech,'submit-order');
 for(const key of ['inspectorId','inspectorName','inspectionClaimedAt'])assert.equal(next[key],original[key]);
 assert.equal(next.stage,'待检验');
 assert.throws(()=>act(next,other,'inspect'),e=>e.status===403);
 assert.equal(act(next,inspector,'inspect').stage,'维修完成');
});
for(const action of ['finish','submit-order'])test(`${action} starts a fresh inspection batch after the previous partial batch passed`,()=>{
 let t=act(claimed(),inspector,'inspect');
 assert.equal(t.items[0].status,'已完工');assert.equal(t.stage,'维修中');
 t=act(t,tech,action,action==='finish'?{itemId:2}:{});
 for(const key of ['inspectorId','inspectorName','inspectionClaimedAt'])assert.equal(t[key],undefined,key);
 t=act(t,other,'claim-inspection');assert.equal(act(t,other,'inspect').stage,'维修完成');
});
test('legacy submit cannot replace a claimed inspector without an inspection handover',()=>{
 let t=claimed();t=act(t,tech,'finish',{itemId:2});
 const before=structuredClone(t);
 assert.throws(()=>act(t,tech,'submit',{inspectorId:other.id}),e=>e.status===409);
 assert.deepEqual(t,before);
 assert.equal(act(t,tech,'submit',{inspectorId:inspector.id}).inspectorId,inspector.id);
});
