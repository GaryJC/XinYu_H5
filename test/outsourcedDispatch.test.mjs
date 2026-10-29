import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDispatchAction} from '../server/domain/dispatchPolicy.mjs';
import {hasPendingInspection} from '../shared/repairProgress.mjs';
import {validatePartsPickupNotification} from '../server/repositories/partsRequirementRepository.mjs';
const advisor={id:'a',name:'派工人甲',role:'advisor',shopId:'s',active:true};
const other={...advisor,id:'b',name:'派工人乙'};
const manager={...advisor,id:'m',role:'manager'};
const warehouse={...advisor,id:'w',role:'warehouse'};
const external={...advisor,id:'external',role:'outsourcing'};
const people=[advisor,other,manager,warehouse,external];
const now='2026-10-29T00:00:00.000Z';
const dueAt='2026-11-01T00:00:00.000Z';
const partsRequirement={mode:'list',items:[{name:'机油',quantity:1,unit:'桶'}],photoIds:[]};
const initial=()=>({orderId:'o',shopId:'s',version:0,stage:'待派工',items:[{id:1,name:'更换机油',status:'待派工'}]});
const act=(task,action,actor=advisor,input={})=>applyDispatchAction(task,{action,requestId:'outsourced-test',expectedVersion:task.version,...input},actor,people,now);
const assigned=()=>act(initial(),'assign',advisor,{executionMode:'outsourced',outsourcingMode:'onsite',contractor:'无系统账号的张师傅',dueAt});

test('free-text contractor rejects blank names and ignores forged account ownership',()=>{
 for(const contractor of ['', '  '])assert.throws(()=>act(initial(),'assign',advisor,{executionMode:'outsourced',outsourcingMode:'onsite',contractor,contractorId:external.id,dueAt}),/承包方/);
 const task=act(initial(),'assign',advisor,{executionMode:'outsourced',outsourcingMode:'onsite',contractor:'张师傅',contractorId:external.id,technicianIds:[external.id],dueAt});
 assert.equal(task.assignedBy,advisor.id);assert.equal(task.contractorId,undefined);assert.deepEqual(task.technicianIds,[]);
 assert.throws(()=>act(task,'complete-outsourced'),/开工/);
});

test('only the actual dispatcher can submit parts, including after reassignment',()=>{
 let task=assigned();
 for(const actor of [other,manager,external])assert.throws(()=>act(task,'record-parts',actor,{partsRequirement}),e=>e.status===403);
 task=act(task,'record-parts',advisor,{partsRequirement});
 assert.equal(task.partsRequirement.applicantId,advisor.id);
 assert.throws(()=>act(task,'start-order'),/备齐/);
 assert.throws(()=>act(task,'complete-outsourced'),/备齐/);
 task=act(task,'reassign',other,{executionMode:'outsourced',outsourcingMode:'onsite',contractor:'李师傅',dueAt,reason:'更换承包方'});
 assert.equal(task.assignedBy,other.id);
 assert.throws(()=>act(task,'record-parts',advisor,{partsRequirement}),e=>e.status===403);
 task=act(task,'record-parts',other,{partsRequirement});
 assert.equal(task.partsRequirement.applicantId,other.id);
 assert.throws(()=>act(task,'confirm-parts',warehouse,{partsPreparation:[{index:0,recipientId:external.id}]}),/有效派工人/);
 task=act(task,'confirm-parts',warehouse,{partsPreparation:[{index:0,recipientId:other.id}]});
 assert.equal(task.stage,'维修中');assert.equal(task.items[0].startedBy,other.id);assert.equal(task.partsRequirement.items[0].recipientName,other.name);
 task=act(task,'issue-parts',warehouse);
 assert.deepEqual(task.partsRequirement.recipientIds,[other.id]);
 task=act(task,'complete-outsourced',manager);
 assert.equal(task.stage,'维修完成');assert.equal(task.completedBy,manager.id);assert.equal(hasPendingInspection(task),false);
 assert.equal(task.items[0].inspectedBy,undefined);
});

test('legacy account-bound external tasks finish internally and cannot re-enter inspection',()=>{
 for(const stage of ['待检验','回审']) {
  const task={...assigned(),stage,contractorId:external.id,technicianIds:[external.id],technicianId:external.id,items:[{id:1,name:'保养',status:'待检验',finishedBy:external.id,finishAt:now}]};
  assert.equal(hasPendingInspection(task),false);
  assert.throws(()=>act(task,'complete-outsourced',external),e=>e.status===403);
  const next=act(task,'complete-outsourced');
  assert.equal(next.stage,'维修完成');assert.equal(next.items[0].finishedBy,external.id);assert.equal(next.items[0].inspectedAt,undefined);
  assert.throws(()=>act(next,'send-review',manager),/无需提检/);
 }
 assert.throws(()=>act({...initial(),stage:'维修中'},'complete-outsourced'),/仅外包/);
});

test('dispatcher pickup reminders work for rows, grouped preparation and photos; wrong or stale recipients are rejected',async()=>{
 let task=act(assigned(),'record-parts',advisor,{partsRequirement});
 task=act(task,'confirm-parts',warehouse,{partsPreparation:[{index:0,recipientId:advisor.id}]});
 const parts=task.partsRequirement;
 const payload={shopId:'s',repairRound:0,partsRecordedAt:parts.recordedAt,partsRevision:parts.revision};
 const selected=[{index:0,preparedAt:now}];
 const database={query:async()=>({rows:[{stage:task.stage,data:task}]})};
 for(const extra of [{partsPreparation:selected},{preparationGroups:[{...payload,items:selected}]},{}]) {
  const row={order_id:'o',recipient_id:advisor.id,kind:'配件可领取',payload:{...payload,...extra}};
  assert.equal(await validatePartsPickupNotification(row,advisor,database),true);
  assert.equal(await validatePartsPickupNotification({...row,recipient_id:other.id},other,database),false);
  assert.equal(await validatePartsPickupNotification(row,{...advisor,active:false},database),false);
  assert.equal(await validatePartsPickupNotification(row,advisor,{query:async()=>({rows:[{stage:task.stage,data:{...task,assignedBy:other.id}}]})}),false);
 }
});

// Conversion keeps old warehouse requests for audit and fulfillment, but they no longer define personal repair ownership.
import {isIndividualRepair,hasUnpreparedParts} from '../shared/repairProgress.mjs';
import {actionParts} from '../server/domain/individualRepair.mjs';
import {enqueueDeferredNotifications,validateDeferredNotification} from '../server/repositories/inspectionDeferredRepository.mjs';
const inherited=()=>({...assigned(),partsRequests:['old-a','old-b'].map(ownerId=>({...structuredClone(partsRequirement),ownerId,ownerName:ownerId,recordedAt:now,revision:1}))});

test('converted external jobs use whole-order parts and reject forged personal scope',()=>{
 const task=inherited();
 assert.equal(isIndividualRepair(task),false);
 const next=act(task,'record-parts',advisor,{partsRequirement});
 assert.equal(actionParts(next,{action:'record-parts'},advisor),next.partsRequirement);
 assert.equal(next.partsRequests.length,2);
 assert.throws(()=>act(task,'record-parts',advisor,{partsOwnerId:'old-a',partsRequirement}),e=>e.status===400);
 // Existing internal multi-worker behavior remains scoped.
 assert.equal(isIndividualRepair({...task,executionMode:'internal'}),true);
});

test('all inherited requests must be prepared before external auto-start or completion, including while paused',()=>{
 for(const paused of [false,true]) {
  let task=inherited();
  if(paused)Object.assign(task,{stage:'暂停',resumeStage:'待开工'});
  task=act(task,'record-parts',advisor,{partsRequirement:{mode:'none'}});
  assert.equal(task.firstStartedAt,undefined);assert.equal(task.items[0].status,'待开工');
  assert.equal(hasUnpreparedParts(task),true);
  assert.throws(()=>act({...task,stage:'待开工'},'start-order'),/备齐/);
  assert.throws(()=>act({...task,stage:'维修中',items:task.items.map(i=>({...i,status:'维修中'}))},'complete-outsourced'),/备齐/);
  task=act(task,'confirm-parts',warehouse,{partsOwnerId:'old-a',partsPreparation:[{index:0,recipientId:advisor.id}]});
  assert.equal(task.firstStartedAt,undefined);assert.equal(task.items[0].status,'待开工');
  if(paused)assert.equal(task.resumeStage,'待开工');
  task=act(task,'confirm-parts',warehouse,{partsOwnerId:'old-b',partsPreparation:[{index:0,recipientId:advisor.id}]});
  assert.equal(task.stage,paused?'暂停':'维修中');assert.equal(task.items[0].status,'维修中');
  assert.equal(task.items[0].startedBy,advisor.id);assert.equal(task.firstStartedAt,now);
  if(paused)assert.equal(task.resumeStage,'维修中');
  assert.equal(hasUnpreparedParts(task),false);
 }
});

test('default external issue uses the current dispatcher after preparation and reassignment',()=>{
 let task=act(assigned(),'record-parts',advisor,{partsRequirement});
 task=act(task,'confirm-parts',warehouse,{partsPreparation:[{index:0,recipientId:advisor.id}]});
 task=act(task,'reassign',other,{executionMode:'outsourced',outsourcingMode:'onsite',contractor:'新师傅',dueAt,reason:'交接'});
 assert.throws(()=>act(task,'issue-parts',warehouse,{partsIssue:[{index:0,recipientId:advisor.id}]}),/有效派工人/);
 task=act(task,'issue-parts',warehouse);
 assert.deepEqual(task.partsRequirement.recipientIds,[other.id]);
 assert.equal(task.partsRequirement.items[0].recipientId,other.id);
});

test('legacy photo pickup and issue use the dispatcher, not the historical request owner',async()=>{
 const parts={mode:'photo',photoIds:['legacy-photo'],items:[],ownerId:'old-tech',ownerName:'历史维修工',recordedAt:now,revision:1,preparedAt:now};
 const task={...assigned(),partsRequests:[parts]};
 const row={order_id:'o',recipient_id:advisor.id,kind:'配件可领取',payload:{shopId:'s',repairRound:0,partsOwnerId:parts.ownerId,partsRecordedAt:now,partsRevision:1}};
 assert.equal(await validatePartsPickupNotification(row,advisor,{query:async()=>({rows:[{stage:task.stage,data:task}]})}),true);
 const next=act(task,'issue-parts',warehouse,{partsOwnerId:parts.ownerId});
 assert.deepEqual(next.partsRequests[0].recipientIds,[advisor.id]);
 assert.equal(next.partsRequests[0].recipientName,advisor.name);
 for(const invalid of [{...advisor,active:false},{...advisor,shopId:'elsewhere'},{...advisor,role:'technician'}]) {
  assert.throws(()=>applyDispatchAction(task,{action:'issue-parts',partsOwnerId:parts.ownerId,requestId:'invalid-recipient',expectedVersion:task.version},warehouse,people.map(p=>p.id===advisor.id?invalid:p),now),/有效派工人/);
 }
});

test('deferred outsourced project dispatch notifies only the current internal dispatcher',async()=>{
 const task=assigned(),calls=[];
 const db={query:async(sql,params)=>{calls.push(params);return {rows:[]};}};
 await enqueueDeferredNotifications(db,task,task,'event',advisor,'schedule',[1],'',people,'deferred-request');
 assert.equal(calls.length,1);assert.equal(calls[0][3],advisor.id);
 const row={order_id:'o',recipient_id:advisor.id,payload:JSON.parse(calls[0][5])};
 const stored={data:task,stage:task.stage,shop_id:'s',pending_repairs:[{source:'inspection',itemId:1,inspectionState:'scheduled',lastOperationRequestId:'deferred-request'}]};
 const query=async()=>({rows:[stored]});
 assert.equal(await validateDeferredNotification(row,advisor,{query}),true);
 assert.equal(await validateDeferredNotification({...row,recipient_id:external.id},external,{query}),false);
 stored.data={...task,assignedBy:other.id};
 assert.equal(await validateDeferredNotification(row,advisor,{query}),false);
});
