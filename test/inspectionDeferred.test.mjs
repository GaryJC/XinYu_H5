import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDispatchAction,validateDispatchRequest} from '../server/domain/dispatchPolicy.mjs';
import {reconcileInspectionDeferred,cancelInspectionDeferred} from '../server/domain/inspectionDeferred.mjs';
import {mergePendingWriteback} from '../server/domain/pendingRepairs.mjs';
import {validateWritebackSnapshot} from '../server/domain/repairWriteback.mjs';
const tech={id:'t',name:'甲',shopId:'s',role:'technician',active:true},other={...tech,id:'u',name:'乙'},inspector={...tech,id:'i',name:'检验员',role:'inspector'};
const people=[tech,other,inspector];
const task=()=>({orderId:'o',shopId:'s',stage:'待检验',version:1,technicianIds:['t','u'],technicianId:'t',inspectorId:'i',items:[{id:1,name:'项目一',status:'待检验',responsibleId:'t',startAt:'start',finishAt:'finish'},{id:2,name:'项目二',status:'待检验',responsibleId:'u'}]});
const input=(patch={})=>({action:'inspect',expectedVersion:1,requestId:'inspection-deferred-test',deferredItemIds:[1],deferredReason:'暂缓处理',...patch});
test('mixed and all-deferred inspection finishes the round without marking deferred projects passed',()=>{
 for(const ids of [[1],[1,2]]) {
  const original=task(),next=applyDispatchAction(original,input({deferredItemIds:ids}),inspector,people);
  assert.equal(next.stage,'维修完成');assert.deepEqual(original,task());assert.deepEqual(next.items.map(i=>i.id),ids.length===1?[2]:[]);
  const pending=reconcileInspectionDeferred([],original,next,input({deferredItemIds:ids}),inspector,'now');
  assert.equal(pending.length,ids.length);assert.equal(pending[0].originalItem.finishAt,'finish');assert.equal(pending[0].inspectionState,'pending');
  assert.equal(pending[0].originalItem.inspectedAt,undefined);
  const snapshot=mergePendingWriteback(next.items,pending);assert.equal(snapshot.length,2);assert.equal(snapshot.find(i=>i.id===1).name,'【待定】项目一');
 }
});
test('deferred and returned projects remain separate and deferred workers do not block later completion',()=>{
 const first=applyDispatchAction(task(),input({rejectedItemIds:[2],reason:'返工'}),inspector,people);
 assert.equal(first.stage,'维修中');assert.deepEqual(first.rejectedItemIds,[2]);assert.equal(first.items.length,1);assert.equal(first.items[0].status,'待开工');
 const next=applyDispatchAction({...first,items:first.items.map(i=>({...i,status:'待检验'}))},{action:'inspect',expectedVersion:first.version,requestId:'later-inspection'},inspector,people);
 assert.equal(next.stage,'维修完成');
});
test('inspection validates disjoint results, submitted IDs, reason and independent inspector',()=>{
 for(const patch of [{deferredReason:''},{deferredItemIds:[1,1]},{deferredItemIds:[99]},{rejectedItemIds:[1]}])assert.throws(()=>applyDispatchAction(task(),input(patch),inspector,people));
 assert.throws(()=>applyDispatchAction(task(),input(),{...tech,role:'inspector'},people),e=>e.status===403);
 assert.throws(()=>validateDispatchRequest(input({action:'accept'})),e=>e.status===400);
 assert.throws(()=>validateDispatchRequest(null),e=>e.status===400);
});
test('scheduled cancellation preserves handover, removes only its project and closes empty work',()=>{
 for(const stage of ['待接单','待开工','维修中','暂停','待检验']) {
  const t={...task(),stage,partsRequests:[{ownerId:'t',issuedAt:'issued',items:[{name:'滤芯'}]}]};
  const entry={itemId:1,inspectionState:'scheduled'};
  const next=cancelInspectionDeferred(t,entry,inspector,'不修','now');
  assert.deepEqual(next.items,[t.items[1]]);assert.deepEqual(next.partsRequests,t.partsRequests);assert.ok(next.participantIds.includes('t'));
  const last=cancelInspectionDeferred({...t,items:[t.items[0]]},entry,inspector,'不修','now');assert.equal(last.stage,'维修完成');
 }
 assert.throws(()=>cancelInspectionDeferred(task(),{itemId:1,inspectionState:'scheduled'},inspector,'','now'),/原因/);
 assert.throws(()=>cancelInspectionDeferred({...task(),items:[{id:1,status:'已完工'}]},{itemId:1,inspectionState:'scheduled'},inspector,'不修','now'),/已检验通过/);
});
test('writeback uses the same identity, never resurrects cancellation, and only explicitly allows empty removal',()=>{
 const p={source:'inspection',itemId:1,name:'【待定】项目一',state:'approved',inspectionState:'scheduled'};
 assert.equal(mergePendingWriteback([{id:1,name:'项目一',status:'已完工'}],[p])[0].name,'【待定】项目一');
 assert.equal(mergePendingWriteback([{id:1,name:'项目一',status:'已完工'}],[{...p,inspectionState:'completed'}])[0].name,'项目一');
 assert.deepEqual(mergePendingWriteback([{id:1,name:'旧轮次项目',status:'已完工'}],[{...p,state:'declined',inspectionState:'cancelled'}]),[]);
 assert.throws(()=>validateWritebackSnapshot({plate:'沪ATEST',items:[]}));
 assert.doesNotThrow(()=>validateWritebackSnapshot({plate:'沪ATEST',items:[],allowEmptyRemoval:true}));
});


test('deleting an unresolved deferred item preserves an already completed round timestamp',()=>{
 const completedAt='2026-09-30T01:00:00Z';
 const original={...task(),stage:'维修完成',completedAt,items:[{id:2,status:'已完工'}]};
 const next=cancelInspectionDeferred(original,{itemId:1,inspectionState:'pending',originalItem:{id:1}},inspector,'不再维修','2026-10-27T01:00:00Z');
 assert.equal(next.completedAt,completedAt);assert.equal(next.stage,'维修完成');
 const active={...original,stage:'维修中',items:[{id:1,status:'维修中'}]};
 assert.equal(cancelInspectionDeferred(active,{itemId:1,inspectionState:'scheduled'},inspector,'不再维修','now').completedAt,'now');
});
