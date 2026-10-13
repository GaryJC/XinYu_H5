import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { applyDispatchAction,assertDispatchAccess,dispatchMetric,completionRange,validateDispatchRequest } from '../server/domain/dispatchPolicy.mjs';
const manager={id:'m',name:'管理员',role:'manager',active:true,shopId:'s'};
const advisor={id:'d',name:'服务顾问',role:'advisor',active:true,shopId:'s'};
const technician={id:'t',name:'同名维修工',role:'technician',active:true,shopId:'s'};
const second={...technician,id:'t2'};
const inspector={id:'i',name:'检验员',role:'inspector',active:true,shopId:'s'};
const people=[manager,advisor,technician,second,inspector];
const now='2026-09-11T01:00:00.000Z';
const due='2026-09-12T18:00:00+08:00';
function initial(){return {orderId:'wo',shopId:'s',stage:'待派工',version:0,items:[{id:1,name:'制动',status:'待派工'},{id:2,name:'保养',status:'待派工'}]};}
function act(task,action,actor=technician,fields={},at=now){return applyDispatchAction(task,{action,expectedVersion:task.version,requestId:randomUUID(),...fields},actor,people,at);}
function assigned(){return act(initial(),'assign',advisor,{technicianId:'t',dueAt:due});}
function submitted(){let t=act(assigned(),'accept');for(const id of [1,2]){t=act(t,'start',technician,{itemId:id});t=act(t,'finish',technician,{itemId:id});}return act(t,'submit',technician,{inspectorId:'i'});}

test('complete lifecycle without parts waits for explicit acceptance and inspection',()=>{
  let task=assigned();assert.equal(task.stage,'待接单');assert.equal(task.dueAt,'2026-09-12T10:00:00.000Z');
  assert.throws(()=>act(task,'start',technician,{itemId:1}),e=>e.status===409);
  task=act(task,'accept');assert.equal(task.stage,'待开工');assert.equal(task.firstStartedAt,undefined);
  task=act(task,'start',technician,{itemId:1});assert.equal(task.stage,'维修中');
  task=act(task,'finish',technician,{itemId:1});
  assert.throws(()=>act(task,'submit',technician,{inspectorId:'i'}),e=>e.status===409);
  task=act(task,'start',technician,{itemId:2});task=act(task,'finish',technician,{itemId:2});
  task=act(task,'submit',technician,{inspectorId:'i'});assert.equal(task.stage,'待检验');assert.equal(task.completedAt,undefined);
  task=act(task,'inspect',inspector);assert.equal(task.stage,'维修完成');assert.equal(task.completedBy,'t');assert.equal(task.completedAt,now);
  assert.ok(task.items.every(i=>i.status==='已完工'));
  assert.throws(()=>act(task,'reassign',advisor,{technicianId:'t2',dueAt:due,reason:'换人'}),e=>e.status===409);
});
test('declining retains assignment and blocks acceptance until advisor reoffers',()=>{
  let task=act(assigned(),'decline',technician,{reason:'工作量已满'});
  assert.equal(task.technicianId,'t');assert.equal(task.stage,'待接单');
  assert.throws(()=>act(task,'accept'),e=>e.status===409);
  task=act(task,'reoffer',advisor);task=act(task,'accept');assert.equal(task.stage,'待开工');
});
test('pause freezes actions without moving delivery deadline; resume restores phase',()=>{
  let task=act(assigned(),'accept');task=act(task,'pause',technician,{pauseReason:'待配件'});
  assert.equal(task.stage,'暂停');assert.equal(task.resumeStage,'待开工');
  assert.throws(()=>act(task,'start',technician,{itemId:1}),e=>e.status===409);
  task=act(task,'resume');assert.equal(task.stage,'待开工');assert.equal(task.dueAt,'2026-09-12T10:00:00.000Z');
  assert.throws(()=>act(task,'pause',technician,{pauseReason:'其他'}),e=>e.status===400);
});
test('in-progress reassignment preserves progress and historical actor, requires acceptance',()=>{
  let task=act(assigned(),'accept');task=act(task,'start',technician,{itemId:1});
  assert.throws(()=>act(task,'reassign',advisor,{technicianId:'t2',dueAt:due}),e=>e.status===400);
  task=act(task,'reassign',advisor,{technicianId:'t2',dueAt:due,reason:'交接制动检查'});
  assert.equal(task.items[0].status,'维修中');assert.equal(task.items[0].startedBy,'t');assert.equal(task.firstStartedAt,now);
  assert.throws(()=>assertDispatchAccess(task,technician),e=>e.status===403);
  assert.throws(()=>act(task,'finish',second,{itemId:1}),e=>e.status===409);
  assert.throws(()=>act(task,'cancel',advisor,{reason:'撤销'}),e=>e.status===409);
  task=act(task,'accept',second);task=act(task,'finish',second,{itemId:1});
  assert.equal(task.items[0].finishedBy,'t2');assert.equal(task.technicianName,technician.name);
});
test('selective rejection preserves passed items and counts completion once',()=>{
  let task=submitted();task=act(task,'inspect',inspector,{rejectedItemIds:[1],reason:'制动复查'});
  assert.equal(task.items[0].status,'待开工');assert.equal(task.items[1].status,'已完工');assert.equal(task.reworkCount,1);
  task=act(task,'start',technician,{itemId:1});task=act(task,'finish',technician,{itemId:1});task=act(task,'submit',technician,{inspectorId:'i'});
  assert.throws(()=>act(task,'inspect',inspector,{rejectedItemIds:[2],reason:'旧项目'}),e=>e.status===400);
  task=act(task,'inspect',manager);assert.equal(task.stage,'维修完成');assert.equal(task.items[1].inspectedBy,'i');assert.equal(task.items[0].inspectedBy,'m');
  assert.throws(()=>act(task,'inspect',manager),e=>e.status===409);
});
test('assignment validates shop, role, active employee and unique ID rather than name',()=>{
  assert.throws(()=>act(initial(),'assign',advisor,{technicianId:'unknown',dueAt:due}),e=>e.status===400);
  assert.throws(()=>act(initial(),'assign',advisor,{technicianId:'i',dueAt:due}),e=>e.status===400);
  assert.throws(()=>act(initial(),'assign',{...advisor,shopId:'other'},{technicianId:'t',dueAt:due}),e=>e.status===403);
  assert.throws(()=>act(assigned(),'accept',{...technician,active:false}),e=>e.status===403);
  assert.throws(()=>act(assigned(),'accept',second),e=>e.status===403);
  assert.doesNotThrow(()=>act(assigned(),'accept',{...technician,name:'已改名'}));
});
test('stale requests, invalid dates, wrong roles and self inspection are rejected',()=>{
  const task=submitted();
  assert.throws(()=>applyDispatchAction(task,{action:'inspect',requestId:randomUUID(),expectedVersion:0},inspector,people),e=>e.status===409);
  assert.throws(()=>act(task,'inspect',advisor),e=>e.status===403);
  assert.throws(()=>act({...task,technicianId:'m'},'inspect',manager),e=>e.status===403);
  assert.throws(()=>act({...task,items:task.items.map(i=>({...i,startedBy:'m'}))},'inspect',manager),e=>e.status===403);
  assert.throws(()=>validateDispatchRequest({action:'assign',expectedVersion:0,requestId:'valid123',dueAt:'tomorrow'}),e=>e.status===400);
  assert.throws(()=>validateDispatchRequest({action:'inspect',expectedVersion:0,requestId:'valid123',rejectedItemIds:[1,1]}),e=>e.status===400);
});
test('historical ambiguity is blocked until manager reconciliation without fabricated dates',()=>{
  const old={...assigned(),legacy:true,needsReview:true,stage:'维修中',items:[{id:1,name:'维修',status:'维修中'}]};
  assert.throws(()=>act(old,'finish',technician,{itemId:1}),e=>e.status===409);
  assert.throws(()=>act(old,'reconcile',advisor,{technicianId:'t',dueAt:due,reason:'核对'}),e=>e.status===403);
  const task=act(old,'reconcile',manager,{technicianId:'t',dueAt:due,reason:'核对'});
  assert.equal(task.firstStartedAt,undefined);assert.equal(task.needsReview,false);assert.equal(task.stage,'待接单');
});
test('metrics separate working, paused and inspection; Shanghai completion boundaries ignore settlement',()=>{
  const range=completionRange(undefined,undefined,new Date('2026-09-30T16:30:00Z'));
  assert.deepEqual(range,{from:'2026-09-30T16:00:00.000Z',to:'2026-10-31T16:00:00.000Z'});
  assert.throws(()=>completionRange('2026-02-30','2026-03-01'),e=>e.status===400);
  const waiting=assigned();assert.equal(dispatchMetric(waiting,'pendingAccept'),true);assert.equal(dispatchMetric(waiting,'unstarted'),true);
  assert.equal(dispatchMetric({...waiting,stage:'暂停'},'working'),false);
  assert.equal(dispatchMetric({...waiting,stage:'待检验'},'working'),false);
  assert.equal(dispatchMetric({...waiting,legacy:true,startHistoryUnknown:true},'unstarted'),false);
  const done={...waiting,stage:'维修完成',completedAt:range.from,orderStatus:'待结算'};
  assert.equal(dispatchMetric(done,'completed',range.from,range.to),true);
  assert.equal(dispatchMetric({...done,orderStatus:'完成'},'completed',range.from,range.to),true);
  assert.equal(dispatchMetric({...done,completedAt:range.to},'completed',range.from,range.to),false);
  assert.equal(dispatchMetric(done,'overdue',undefined,undefined,new Date('2027-01-01')),false);
});

test('signed legacy orders with no recorded repair work still count as unstarted after assignment',()=>{
  const task=act({...initial(),legacy:true,startHistoryUnknown:false},'assign',advisor,{technicianId:'t',dueAt:due});
  assert.equal(dispatchMetric(task,'unstarted'),true);
});
test('historical completed identities can be reconciled without reopening or inventing dates',()=>{
  const task=act({...initial(),legacy:true,needsReview:true,stage:'维修完成'},'reconcile',manager,{technicianId:'t',reason:'核对纸质档案'});
  assert.equal(task.technicianId,'t');assert.equal(task.stage,'维修完成');assert.equal(task.completedAt,undefined);assert.equal(task.assignedAt,undefined);
});

test('uncertain legacy start history cannot be canceled or counted as never started',()=>{
  let task=act({...assigned(),legacy:true,needsReview:true,startHistoryUnknown:true,stage:'维修中'},'reconcile',manager,{technicianId:'t',dueAt:due,reason:'核对在修单'});
  assert.throws(()=>act(task,'cancel',advisor,{reason:'撤销'}),e=>e.status===409);
  task=act(task,'accept');assert.equal(task.stage,'维修中');assert.equal(task.firstStartedAt,undefined);
});

test('removed dispatcher role cannot retain scheduling access',()=>{
  assert.throws(()=>act(initial(),'assign',{...advisor,role:'dispatcher'},{technicianId:'t',dueAt:due}),e=>e.status===403);
});

test('equal collaborators share one progress and reassignment removes access',()=>{
  let task=act(initial(),'assign',advisor,{technicianIds:['t','t2'],dueAt:due});
  assert.deepEqual(task.technicianIds,['t','t2']);
  assert.doesNotThrow(()=>assertDispatchAccess(task,second));
  task=act(task,'accept',second);
  task=act(task,'start',technician,{itemId:1});
  task=act(task,'finish',second,{itemId:1});
  assert.equal(task.items[0].startedBy,'t');assert.equal(task.items[0].finishedBy,'t2');
  task=act(task,'reassign',advisor,{technicianIds:['t2'],dueAt:due,reason:'人员调整'});
  assert.throws(()=>assertDispatchAccess(task,technician),e=>e.status===403);
  assert.doesNotThrow(()=>assertDispatchAccess(task,second));
  assert.deepEqual(task.participantIds,['t','t2']);
  assert.equal(act(task,'accept',second).stage,'维修中');
});

test('invalid collaborator lists cannot bypass employee validation',()=>{
  for(const ids of [[],['t','t'],['t','unknown'],['t','i'],[null]]) assert.throws(()=>act(initial(),'assign',advisor,{technicianIds:ids,dueAt:due}),e=>e.status===400);
  assert.throws(()=>act({...assigned(),stage:'待接单'},'reassign',advisor,{technicianIds:['t'],dueAt:due,reason:'相同名单'}),e=>e.status===409);
});

test('field work means employees leave for a service unit and retains shared progress',()=>{
  assert.throws(()=>act(initial(),'assign',advisor,{executionMode:'field',technicianIds:['t','t2'],dueAt:due}),e=>e.status===400);
  let task=act(initial(),'assign',advisor,{executionMode:'field',technicianIds:['t','t2'],serviceUnit:'客户车队',serviceAddress:'客户停车场',departureAt:now,expectedReturnAt:due,dueAt:due});
  assert.equal(task.serviceUnit,'客户车队');assert.equal(task.executionMode,'field');
  task=act(task,'accept',second);task=act(task,'start',second,{itemId:1});
  assert.equal(task.stage,'维修中');
  assert.throws(()=>act(task,'update',advisor,{returnedAt:'2026-09-10T01:00:00Z'}),e=>e.status===400);
  task=act(task,'update',advisor,{returnedAt:due});assert.equal(task.returnedAt,due);
});

for(const outsourcingMode of ['onsite','offsite']) test(`outsourced ${outsourcingMode} lifecycle is tracked internally and independently inspected`,()=>{
  let task=act(initial(),'assign',advisor,{executionMode:'outsourced',contractor:'承包单位',outsourcingMode,agreedFee:123.45,dueAt:due});
  assert.deepEqual(task.technicianIds,[]);assert.equal(task.technicianId,undefined);
  assert.throws(()=>assertDispatchAccess(task,technician),e=>e.status===403);
  task=act(task,'accept',advisor);
  for(const itemId of [1,2]) {task=act(task,'start',manager,{itemId});task=act(task,'finish',advisor,{itemId});}
  assert.throws(()=>act(task,'submit',advisor,{inspectorId:'m'}),e=>e.status===403);
  task=act(task,'submit',advisor,{inspectorId:'i'});
  assert.throws(()=>act(task,'inspect',manager),e=>e.status===403);
  task=act(task,'inspect',inspector,{rejectedItemIds:[1],reason:'返工'});
  task=act(task,'start',advisor,{itemId:1});task=act(task,'finish',advisor,{itemId:1});
  task=act(task,'submit',advisor,{inspectorId:'i'});task=act(task,'inspect',inspector);
  assert.equal(task.stage,'维修完成');assert.equal(task.agreedFee,123.45);
});

test('execution validation rejects malformed costs, timestamps and silent mode changes',()=>{
  for(const fields of [{executionMode:'unknown'},{agreedFee:-1},{agreedFee:'100'},{agreedFee:1.001},{departureAt:'2026-09-11T01:00:00'},{outsourcingMode:'unknown'}]) assert.throws(()=>act(initial(),'assign',advisor,{technicianIds:['t'],dueAt:due,...fields}),e=>e.status===400);
  assert.throws(()=>act(assigned(),'update',advisor,{executionMode:'outsourced',contractor:'单位',outsourcingMode:'onsite'}),e=>e.status===400);
  let task=act(initial(),'assign',advisor,{executionMode:'field',technicianIds:['t'],serviceUnit:'客户车队',serviceAddress:'停车场',dueAt:due});
  task=act(task,'reassign',advisor,{executionMode:'outsourced',outsourcingMode:'onsite',contractor:'承包方',dueAt:due,reason:'转外包'});
  assert.equal(task.serviceUnit,undefined);assert.deepEqual(task.technicianIds,[]);
  task=act(task,'update',advisor,{agreedFee:100});
  task=act(task,'update',advisor,{agreedFee:null});assert.equal(task.agreedFee,null);
});

test('only scheduling staff record positive work hours with amendment audit and closed-order lock',()=>{
  let task=act(assigned(),'accept');task=act(task,'start',technician,{itemId:1});
  assert.throws(()=>act(task,'record-hours',technician,{workHours:2}),e=>e.status===403);
  for(const workHours of [0,-1,1.001,'2',Infinity]) assert.throws(()=>act(task,'record-hours',advisor,{workHours}),e=>e.status===400);
  task=act(task,'record-hours',advisor,{workHours:2.5});
  assert.equal(task.workHoursRecordedBy,advisor.id);assert.equal(task.workHours,2.5);
  assert.throws(()=>act(task,'record-hours',advisor,{workHours:3}),e=>e.status===400);
  task=act(task,'record-hours',manager,{workHours:3,reason:'核对后调整'});
  assert.equal(task.workHours,3);assert.equal(task.workHoursRecordedBy,manager.id);
  assert.throws(()=>act({...task,stage:'维修完成',orderStatus:'完成'},'record-hours',advisor,{workHours:4,reason:'调整'}),e=>e.status===409);
  assert.throws(()=>act(task,'update',advisor,{workHours:5}),e=>e.status===400);
});
