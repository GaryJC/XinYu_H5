import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDispatchAction} from '../server/domain/dispatchPolicy.mjs';
import {personalOrderTodos} from '../server/domain/personalWorkbench.mjs';
import {canStartRepairWithParts,personalRepairStage,personalFeedback,hasDeclinedWork} from '../shared/repairProgress.mjs';
import {canRequestPhotoWaiver,repairPhotoWaiverScope} from '../shared/repairPhotoWaiver.mjs';
const a={id:'a',name:'维修甲',role:'technician',shopId:'s',active:true},b={...a,id:'b',name:'维修乙'};
const advisor={...a,id:'advisor',name:'顾问',role:'advisor'},warehouse={...a,id:'w',role:'warehouse'};
const people=[a,b,advisor,warehouse],now='2026-11-12T10:00:00Z';
const parts={mode:'none'};
const base=()=>({orderId:'o',shopId:'s',orderStatus:'已委托',stage:'待接单',version:1,technicianIds:['a','b'],technicianId:'a',assignedBy:advisor.id,assignedAt:'2026-11-12T09:00:00Z',advisor:advisor.name,items:[{id:1,name:'保养',status:'待开工',responsibleId:'a',responsibleName:a.name},{id:2,name:'检查',status:'待开工',responsibleId:'b',responsibleName:b.name}]});
const act=(task,actor,action,extra={})=>applyDispatchAction(task,{action,requestId:'individual-offer',expectedVersion:task.version,...extra},actor,people,now);
const refused=()=>act(base(),a,'decline',{reason:'无法施工，请另行安排'});
const categories=(task,user)=>personalOrderTodos(task,user).map(t=>t.category);

test('personal refusal preserves coworkers acceptance and keeps the scheduler todo after work starts',()=>{
 const original=base(),next=act(original,a,'decline',{reason:'无法施工，请另行安排'});
 assert.deepEqual(original,base());assert.equal(next.version,2);assert.equal(next.stage,'待接单');assert.equal(next.feedback,undefined);assert.deepEqual(next.items,original.items);
 assert.equal(personalFeedback(next,a.id),'无法施工，请另行安排');assert.equal(personalFeedback(next,b.id),undefined);
 assert.deepEqual(categories(next,a),[]);assert.deepEqual(categories(next,b),['待接单']);assert.deepEqual(categories(next,advisor),['无法接单待处理']);
 const accepted=act(next,b,'accept',{partsRequirement:parts});
 assert.equal(accepted.stage,'维修中');assert.equal(accepted.items[1].status,'维修中');assert.deepEqual(accepted.items[0],original.items[0]);
 assert.equal(personalRepairStage(accepted,a.id),'待接单');assert.equal(personalRepairStage(accepted,b.id),'维修中');
 assert.deepEqual(categories(accepted,a),[]);assert.deepEqual(categories(accepted,advisor),['无法接单待处理']);
 const submitted=act(accepted,b,'submit-order');assert.equal(submitted.items[1].status,'待检验');assert.deepEqual(submitted.items[0],original.items[0]);assert.equal(submitted.stage,'维修中');
});

test('refusal cannot be bypassed by personal repair, material, photo waiver, or warehouse auto-start',()=>{
 let task=act(refused(),b,'accept',{partsRequirement:parts});
 for(const action of ['accept','decline','start-order','start','submit-order','finish','pick','record-parts','edit-repair-items','pause','resume','submit']) {
  assert.throws(()=>act(task,a,action,{...(['accept','record-parts'].includes(action)?{partsRequirement:parts}:{}),reason:'再次拒单'}),/无法接单|不能拒单/);
 }
 assert.equal(canStartRepairWithParts(task,a.id),false);assert.equal(canRequestPhotoWaiver(task,a),false);
 const material={mode:'list',items:[{name:'滤芯',quantity:1,unit:'个'}],photoIds:[],recordedAt:'old'};
 for(const personal of [true,false]) {
  const pending={...task,...(personal?{partsRequests:[...(task.partsRequests||[]),{...material,ownerId:a.id}]}:{partsRequirement:material})};
  const prepared=act(pending,warehouse,'confirm-parts',personal?{partsOwnerId:a.id}:{});
  assert.equal(prepared.items[0].status,'待开工');assert.deepEqual(prepared.workerOffers,task.workerOffers);
 }
});

test('reoffer affects only declined workers and requires their acceptance without resetting others',()=>{
 const task=act(refused(),b,'accept',{partsRequirement:parts}),scope=repairPhotoWaiverScope(task,b.id);
 const offered=act(task,advisor,'reoffer');
 assert.equal(offered.stage,task.stage);assert.equal(offered.assignedAt,task.assignedAt);assert.equal(offered.assignedBy,task.assignedBy);assert.equal(offered.acceptedAt,task.acceptedAt);assert.deepEqual(offered.items,task.items);assert.deepEqual(offered.partsRequests,task.partsRequests);assert.equal(repairPhotoWaiverScope(offered,b.id),scope);
 assert.equal(offered.workerOffers.a.status,'pending');assert.equal(hasDeclinedWork(offered),false);assert.equal(personalFeedback(offered,a.id),undefined);
 assert.deepEqual(categories(offered,a),['待接单']);assert.deepEqual(categories(offered,advisor),[]);
 for(const action of ['start-order','record-parts','pause','submit-order','edit-repair-items'])assert.throws(()=>act(offered,a,action,action==='record-parts'?{partsRequirement:parts}:{}),/先确认本人接单/);
 assert.equal(canRequestPhotoWaiver(offered,a),false);
 const declinedAgain=act(offered,a,'decline',{reason:'仍无法接单'});assert.equal(declinedAgain.workerOffers.a.reason,'仍无法接单');assert.deepEqual(declinedAgain.items,task.items);
 const accepted=act(offered,a,'accept',{partsRequirement:parts});assert.equal(accepted.workerOffers.a,undefined);assert.equal(accepted.items[0].status,'维修中');assert.deepEqual(accepted.items[1],task.items[1]);assert.equal(accepted.acceptedAt,task.acceptedAt);assert.deepEqual(accepted.partsRequests.find(p=>p.ownerId==='b'),task.partsRequests[0]);
 assert.throws(()=>act(accepted,a,'accept',{partsRequirement:parts}),/任务已接单/);
 assert.throws(()=>applyDispatchAction(accepted,{action:'decline',expectedVersion:offered.version,requestId:'stale-offer',reason:'旧页面'},a,people),/已更新/);
});

test('multiple declines and a retained solo worker remain personal; legacy feedback remains explicit',()=>{
 const both=act(refused(),b,'decline',{reason:'时间冲突'}),offered=act(both,advisor,'reoffer');
 assert.deepEqual(Object.values(offered.workerOffers).map(o=>o.status),['pending','pending']);
 const first=act(offered,a,'accept',{partsRequirement:parts});assert.equal(personalRepairStage(first,b.id),'待接单');
 const second=act(first,b,'accept',{partsRequirement:parts});assert.deepEqual(second.workerOffers,{});assert.ok(second.items.every(i=>i.status==='维修中'));
 const solo={...refused(),technicianIds:['a'],items:[base().items[0]]};assert.throws(()=>act(solo,a,'accept',{partsRequirement:parts}),/无法接单/);assert.equal(act(act(solo,advisor,'reoffer'),a,'accept',{partsRequirement:parts}).items[0].status,'维修中');
 const legacy={...base(),feedback:'历史拒单人员未知'};assert.throws(()=>act(legacy,b,'accept',{partsRequirement:parts}),/无法接单/);assert.equal(act(act(legacy,advisor,'reoffer'),b,'accept',{partsRequirement:parts}).items[1].status,'维修中');
 const single={...base(),technicianIds:['a'],items:[base().items[0]]};assert.equal(act(single,a,'decline',{reason:'单人拒单'}).feedback,'单人拒单');
});

test('handover removes departed worker offers and whole reassignment/cancel reset them',()=>{
 const task=refused();
 const handed=act(task,advisor,'reassign',{reassignItemIds:[1],repairItems:[{id:1,name:'保养',responsibleId:'b'}],reason:'改派甲项目'});
 assert.equal(handed.workerOffers.a,undefined);assert.equal(hasDeclinedWork(handed),false);assert.equal(handed.items[0].responsibleId,'b');
 const reassigned=act(task,advisor,'reassign',{technicianIds:['b'],dueAt:'2026-11-13T08:00:00Z',reason:'整单改派'});assert.equal(reassigned.workerOffers,undefined);
 const cancelled=act(task,advisor,'cancel',{reason:'取消派工'});assert.equal(cancelled.workerOffers,undefined);
 assert.throws(()=>act(task,b,'reoffer'),/仅服务顾问/);
 assert.throws(()=>act(base(),a,'decline',{reason:'  '}),/填写原因/);
});
