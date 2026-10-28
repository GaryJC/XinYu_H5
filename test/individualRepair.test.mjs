import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDispatchAction,assertDispatchAccess} from '../server/domain/dispatchPolicy.mjs';
const a={id:'a',name:'维修甲',role:'technician',shopId:'s',active:true},b={...a,id:'b',name:'维修乙'},w={...a,id:'w',name:'仓管',role:'warehouse'};
const people=[a,b,w];
const base=()=>({orderId:'o',shopId:'s',orderStatus:'维修中',stage:'维修中',acceptedAt:'accepted',version:1,technicianIds:['a','b'],items:[{id:1,name:'保养',status:'维修中',responsibleId:'a',responsibleName:a.name,startedBy:'a'},{id:2,name:'检查',status:'维修中',responsibleId:'b',responsibleName:b.name,startedBy:'b'}]});
const act=(task,actor,action,extra={})=>applyDispatchAction(task,{action,requestId:'individual-repair',expectedVersion:task.version,...extra},actor,people,'2026-10-22T01:00:00Z');
const parts=name=>({mode:'list',items:[{name,quantity:1,unit:'个'}],photoIds:[]});
test('each worker completes only their projects and last submission enters inspection',()=>{
 const original=base(),first=act(original,a,'submit-order',{note:'甲已完成'});
 assert.equal(first.stage,'维修中');assert.deepEqual(first.items[1],original.items[1]);assert.equal(first.items[0].finishedBy,'a');assert.equal(first.submittedAt,undefined);
 assert.throws(()=>act(first,a,'submit-order'),/已提交/);
 assert.throws(()=>act(first,a,'record-parts',{partsRequirement:parts('滤芯')}),/已提交/);
 const final=act(first,b,'submit-order',{note:'乙已完成'});
 assert.equal(final.stage,'待检验');assert.equal(final.items[1].finishedBy,'b');assert.match(final.submissionNote,/甲已完成/);assert.match(final.submissionNote,/乙已完成/);
 assert.deepEqual(original,base());
});
test('requests, preparation and issue stay separate; other worker pending parts do not block completion',()=>{
 const first=act(base(),a,'record-parts',{partsRequirement:parts('滤芯')});
 const second=act(first,b,'record-parts',{partsRequirement:parts('雨刮')});
 assert.equal(second.partsRequests.length,2);assert.deepEqual(second.partsRequests[0],first.partsRequests[0]);
 assert.doesNotThrow(()=>assertDispatchAccess(second,w));
 assert.throws(()=>act(second,a,'submit-order'),/确认配件备齐/);
 let next=act(second,w,'confirm-parts',{partsOwnerId:'a'});
 assert.equal(next.partsRequests.find(p=>p.ownerId==='b').preparedAt,undefined);

 assert.ok(next.partsRequests.find(p=>p.ownerId==='a').preparedAt);assert.equal(next.items[1].pickedAt,undefined);
 next=act(next,a,'submit-order');assert.equal(next.stage,'维修中');
 assert.throws(()=>act(next,b,'submit-order'),/确认配件备齐/);
 next=act(next,w,'confirm-parts',{partsOwnerId:'b'});
 assert.equal(act(next,b,'submit-order').stage,'待检验');
});
test('one worker cannot mutate another project or application, or bypass submission',()=>{
 const task=act(base(),b,'record-parts',{partsRequirement:parts('雨刮')});
 assert.throws(()=>act(task,a,'record-parts',{partsOwnerId:'b',partsRequirement:parts('滤芯')}),e=>e.status===403);
 for(const action of ['edit-repair-items','submit-order'])assert.throws(()=>act(task,a,action,{repairItems:task.items.map(i=>({id:i.id,name:i.name,responsibleId:i.responsibleId}))}),e=>e.status===403);
 for(const action of ['start','pick'])assert.throws(()=>act(task,a,action,{itemId:2}),e=>e.status===403);
 assert.throws(()=>act(task,a,'finish',{itemId:1}),/提交本人完工/);
 assert.throws(()=>act(task,a,'submit',{inspectorId:'w'}),/分别提交/);
 assert.throws(()=>act(task,w,'confirm-parts'),/没有待处理/);
 assert.throws(()=>act(task,w,'confirm-parts',{partsOwnerId:'missing'}),/不存在/);
 assert.throws(()=>act({...task,needsReview:true},a,'submit-order'),/核对/);
});
test('issue auto-starts only requester pending projects even while coworker is already working',()=>{
 const task=base();task.items[1].status='待开工';delete task.items[1].startedBy;
 let next=act(task,b,'record-parts',{partsRequirement:parts('雨刮')});
 next=act(next,w,'confirm-parts',{partsOwnerId:'b'});
 assert.equal(next.items[1].status,'维修中');assert.equal(next.items[1].startedBy,'b');assert.deepEqual(next.items[0],task.items[0]);
});
test('acceptance starts only accepter work; others can request later, and stale submissions conflict',()=>{
 const task={...base(),stage:'待接单',acceptedAt:undefined,items:base().items.map(i=>({...i,status:'待开工',startedBy:undefined}))};
 const next=act(task,a,'accept',{partsRequirement:{mode:'none'}});
 assert.equal(next.items[0].status,'维修中');assert.equal(next.items[1].status,'待开工');
 const updated=act(next,b,'record-parts',{partsRequirement:parts('雨刮')});assert.equal(updated.partsRequests.length,2);
 assert.throws(()=>act(updated,a,'submit-order',{expectedVersion:next.version}),/已更新/);
});
test('legacy shared material gate is preserved and new applications never overwrite it',()=>{
 const task={...base(),partsRequirement:{...parts('旧共同申请'),recordedBy:'a'}};
 const next=act(task,b,'record-parts',{partsRequirement:parts('乙新增')});
 assert.deepEqual(next.partsRequirement,task.partsRequirement);
 assert.throws(()=>act(next,a,'submit-order'),/历史共同配件/);
});
test('legacy item-level completions can still be submitted without resubmitting coworkers',()=>{
 const task={...base(),items:base().items.map(i=>({...i,status:'待检验',finishedBy:i.responsibleId}))};
 const next=act(task,a,'submit-order');assert.equal(next.stage,'待检验');assert.equal(next.items[1].finishedBy,'b');
});

test('scheduler and technician memberships retain full task editing without widening personal submissions',()=>{
 for(const role of ['manager','advisor']) {
  const actor={...a,role,roles:[role,'technician']};
  const task=base();
  const rows=task.items.map(i=>({id:i.id,name:i.name+'修改',responsibleId:i.responsibleId}));
  const edited=act(task,actor,'edit-repair-items',{repairItems:rows});
  assert.deepEqual(edited.items.map(i=>i.name),rows.map(i=>i.name));
  const removed=act(task,actor,'edit-repair-items',{repairItems:[rows[1]]});
  assert.deepEqual(removed.items.map(i=>i.id),[2]);
  const submitted=act(task,actor,'submit-order');
  assert.equal(submitted.items[0].status,'待检验');assert.equal(submitted.items[1].status,'维修中');
  const review={...task,stage:'回审'};
  assert.throws(()=>act(review,actor,'submit-review',{repairItems:rows}),e=>e.status===403);
  assert.throws(()=>act(review,actor,'edit-repair-items',{repairItems:rows}),e=>e.status===403);
  const personal=act(review,actor,'edit-repair-items',{repairItems:[rows[0]]});
  assert.equal(personal.stage,'回审');assert.deepEqual(personal.items[1],task.items[1]);
 }
});

test('assigned coworker without items can request parts and add work; first worker cannot submit the whole team',()=>{
 const task=base();task.items=task.items.slice(0,1);
 const first=act(task,a,'submit-order');assert.equal(first.stage,'维修中');
 const requested=act(first,b,'record-parts',{partsRequirement:parts('卡扣')});
 assert.equal(requested.partsRequests[0].ownerId,'b');
 const edited=act(requested,b,'edit-repair-items',{repairItems:[{name:'喷漆',responsibleId:'b'}]});
 assert.equal(edited.items[0].status,'待检验');
 assert.ok(edited.items.some(i=>i.responsibleId==='b'));
 const ready=act(edited,w,'confirm-parts',{partsOwnerId:'b'});
 assert.equal(act(ready,b,'submit-order').stage,'待检验');
});
test('review also allows the missing coworker to add personal work and keeps other submissions independent',()=>{
 const task={...base(),stage:'回审'};task.items=task.items.slice(0,1);
 const first=act(task,a,'submit-review');assert.equal(first.stage,'回审');
 const requested=act(first,b,'record-parts',{partsRequirement:{mode:'none'}});
 const edited=act(requested,b,'edit-repair-items',{repairItems:[{name:'喷漆',responsibleId:'b'}]});
 assert.equal(edited.stage,'回审');assert.equal(edited.items[0].status,'待检验');
 assert.equal(act(edited,b,'submit-review').stage,'待检验');
});
test('personal pause blocks only its owner and cannot be cleared by a coworker',()=>{
 const paused=act(base(),a,'pause',{pauseReason:'待配件'});
 assert.equal(paused.stage,'维修中');assert.ok(paused.workerPauses.a);
 assert.throws(()=>act(paused,a,'submit-order'),/暂停/);
 const submitted=act(paused,b,'submit-order');assert.equal(submitted.items[1].status,'待检验');
 assert.ok(submitted.workerPauses.a);assert.throws(()=>act(submitted,b,'resume'),/当前/);
 const resumed=act(submitted,a,'resume');assert.equal(resumed.workerPauses.a,undefined);
 assert.equal(act(resumed,a,'submit-order').stage,'待检验');
});
test('unassigned worker can accept first, request parts and add personal projects',()=>{
 const task=base();task.stage='待接单';delete task.acceptedAt;task.items=task.items.slice(0,1).map(i=>({...i,status:'待开工'}));
 const accepted=act(task,b,'accept',{partsRequirement:{mode:'none'}});
 assert.ok(accepted.partsRequests.find(p=>p.ownerId==='b'));
 const edited=act(accepted,b,'edit-repair-items',{repairItems:[{name:'喷漆',responsibleId:'b'}]});
 assert.ok(edited.items.some(i=>i.responsibleId==='b'));
});
test('inspection passes only submitted projects while coworker continues, then finishes the full team',()=>{
 const inspector={...a,id:'i',role:'inspector',name:'检验员'};
 const inspectAct=(task,action,extra={})=>applyDispatchAction(task,{action,expectedVersion:task.version,requestId:'independent-inspection',...extra},inspector,[...people,inspector]);
 let task=act(base(),a,'submit-order');task=inspectAct(task,'claim-inspection');
 assert.throws(()=>inspectAct(task,'inspect',{workHours:2}),/全部项目检验通过/);
 task=inspectAct(task,'inspect');assert.equal(task.stage,'维修中');assert.equal(task.completedAt,undefined);assert.equal(task.completedBy,undefined);
 assert.equal(task.items[0].status,'已完工');assert.equal(task.items[1].status,'维修中');
 task=act(task,b,'record-parts',{partsRequirement:{mode:'none'}});
 task=act(task,b,'submit-order');task=inspectAct(task,'claim-inspection');task=inspectAct(task,'inspect');
 assert.equal(task.stage,'维修完成');
});
test('partial inspection return preserves other worker progress and permits personal resubmission',()=>{
 const inspector={...a,id:'i',role:'manager'};
 const original=base();let task=act(original,a,'submit-order');
 task=applyDispatchAction(task,{action:'inspect',expectedVersion:task.version,requestId:'partial-return-test',rejectedItemIds:[1],reason:'补修'},inspector,[...people,inspector]);
 assert.deepEqual(task.items[1],original.items[1]);
 task=act(task,a,'start-order');task=act(task,a,'submit-order');assert.equal(task.stage,'维修中');
});
test('passing a coworker inspection preserves another workers outstanding rework',()=>{
 const inspector={...a,id:'i',role:'manager'};
 const inspect=(task,extra={})=>applyDispatchAction(task,{action:'inspect',expectedVersion:task.version,requestId:'parallel-rework',...extra},inspector,[...people,inspector]);
 let task=act(base(),a,'submit-order');
 task=inspect(task,{rejectedItemIds:[1],reason:'补修'});
 task=act(task,b,'submit-order');task=inspect(task);
 assert.equal(task.stage,'维修中');assert.equal(task.rework,true);
 assert.equal(task.items[0].status,'待开工');assert.equal(task.items[1].status,'已完工');
 assert.equal(task.completedAt,undefined);assert.equal(task.completedBy,undefined);
 task=act(task,a,'start-order');task=act(task,a,'submit-order');task=inspect(task);
 assert.equal(task.stage,'维修完成');assert.equal(task.rework,false);
});

test('preparing a paused workers parts updates their resume stage without releasing either pause',()=>{
 let task={...base(),stage:'待开工',items:base().items.map(i=>({...i,status:'待开工'}))};
 task=act(task,a,'record-parts',{partsRequirement:parts('滤芯')});
 task=act(task,a,'pause',{pauseReason:'待配件'});
 task=act(task,b,'pause',{pauseReason:'技术问题'});
 const otherPause=structuredClone(task.workerPauses.b);
 task=act(task,w,'confirm-parts',{partsOwnerId:'a'});
 assert.equal(task.workerPauses.a.resumeStage,'维修中');
 assert.deepEqual(task.workerPauses.b,otherPause);
 task=act(task,a,'resume');
 assert.equal(task.items[0].status,'维修中');
 assert.equal(task.workerPauses.a,undefined);
 assert.deepEqual(task.workerPauses.b,otherPause);
 assert.equal(act(task,a,'submit-order').items[0].status,'待检验');
});
test('pending legacy parts block work but do not block personal pause, resume or editing',()=>{
 let task={...base(),partsRequirement:parts('共同配件')};
 task=act(task,a,'pause',{pauseReason:'待配件'});
 task=act(task,a,'edit-repair-items',{repairItems:[{id:1,name:'保养核对'}]});
 task=act(task,a,'resume');
 assert.equal(task.items[0].name,'保养核对');
 assert.throws(()=>act(task,a,'submit-order'),/历史共同配件/);
});
test('last worker submission preserves an active inspection claim',()=>{
 const inspector={...a,id:'i',role:'inspector',name:'检验员'};
 let task=act(base(),a,'submit-order');
 task=applyDispatchAction(task,{action:'claim-inspection',expectedVersion:task.version,requestId:'claim-team-test'},inspector,[...people,inspector],'claimed');
 task=act(task,b,'submit-order');
 assert.equal(task.stage,'待检验');assert.equal(task.inspectorId,'i');assert.equal(task.inspectionClaimedAt,'claimed');
});
test('a fresh partial submission clears a completed inspection claim',()=>{
 const third={...a,id:'c'};
 const task={...base(),technicianIds:['a','b','c'],inspectorId:'old',inspectorName:'旧检验员',inspectionClaimedAt:'old',items:[{...base().items[0],status:'已完工'},base().items[1],{id:3,name:'新增工作',responsibleId:'c',status:'维修中'}]};
 const next=applyDispatchAction(task,{action:'submit-order',expectedVersion:1,requestId:'fresh-partial-claim'},b,[...people,third]);
 assert.equal(next.stage,'维修中');assert.equal(next.inspectorId,undefined);assert.equal(next.inspectorName,undefined);assert.equal(next.inspectionClaimedAt,undefined);
});
test('partial inspection does not resume a globally paused team on pass or return',()=>{
 const inspector={...a,id:'i',role:'manager'};
 for(const rejectedItemIds of [[],[1]]) {
  const task={...act(base(),a,'submit-order'),stage:'暂停',resumeStage:'维修中',pauseReason:'技术问题',pausedAt:'paused'};
  const next=applyDispatchAction(task,{action:'inspect',expectedVersion:task.version,requestId:'inspect-paused-team',rejectedItemIds,reason:'补修'},inspector,[...people,inspector]);
  assert.equal(next.stage,'暂停');assert.equal(next.pausedAt,'paused');assert.equal(next.resumeStage,'维修中');
  assert.deepEqual(next.items[1],task.items[1]);
 }
});
test('inspection of submitted work is independent of an unassigned unfinished project',()=>{
 const inspector={...a,id:'i',role:'manager'};
 const task=act(base(),a,'submit-order');delete task.items[1].responsibleId;delete task.items[1].responsibleName;
 const next=applyDispatchAction(task,{action:'inspect',expectedVersion:task.version,requestId:'inspect-owned-only'},inspector,[...people,inspector]);
 assert.equal(next.items[0].status,'已完工');assert.equal(next.items[1].status,'维修中');assert.equal(next.stage,'维修中');assert.equal(next.completedAt,undefined);
});
test('a legacy team-wide pause can be resumed without clearing individual pauses',()=>{
 const task={...base(),stage:'暂停',resumeStage:'维修中',pauseReason:'待配件',pausedAt:'legacy',workerPauses:{b:{resumeStage:'维修中',pauseReason:'技术问题',pausedAt:'personal'}}};
 const next=act(task,a,'resume');
 assert.equal(next.stage,'维修中');assert.equal(next.pausedAt,undefined);assert.equal(next.pauseReason,undefined);
 assert.deepEqual(next.workerPauses.b,task.workerPauses.b);
 assert.throws(()=>act(next,b,'submit-order'),/暂停/);
});

for(const order of [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]) {
 test(`three workers submit and inspect in order ${order.join('-')} without overwriting peers`,()=>{
  const c={...a,id:'c',name:'维修丙'},inspector={...a,id:'i',role:'inspector'},roster=[a,b,c,inspector];
  let task={...base(),technicianIds:['a','b','c'],items:[...base().items,{id:3,name:'喷漆',responsibleId:'c',status:'维修中'}]};
  const run=(actor,action)=>applyDispatchAction(task,{action,expectedVersion:task.version,requestId:'three-worker-matrix'},actor,roster);
  for(const [index,workerIndex] of order.entries()) {
   const actor=roster[workerIndex],before=structuredClone(task);
   task=run(actor,'submit-order');
   assert.deepEqual(task.items.filter(i=>i.responsibleId!==actor.id),before.items.filter(i=>i.responsibleId!==actor.id));
   assert.equal(task.inspectorId,undefined);
   task=run(inspector,'claim-inspection');task=run(inspector,'inspect');
   assert.equal(task.items.filter(i=>i.status==='已完工').length,index+1);
   assert.equal(task.stage,index===2?'维修完成':'维修中');
   if(index<2)assert.equal(task.completedAt,undefined);
  }
 });
}


test('technician edits submitted pending parts while preserving handled lines and other workers',()=>{
 const original=act(base(),a,'record-parts',{partsRequirement:{mode:'list',items:[{name:'滤芯',quantity:1,unit:'个'},{name:'耗材',quantity:2,unit:'片'}]}});
 const shared=act(original,b,'record-parts',{partsRequirement:parts('雨刮')});
 const prepared=act(shared,w,'confirm-parts',{partsOwnerId:'a',partsPreparation:[{index:0,recipientId:'a'}]});
 const before=structuredClone(prepared),saved=prepared.partsRequests.find(p=>p.ownerId==='a');
 const edited=act(prepared,a,'record-parts',{partsRequirement:{mode:'list',items:[{name:'新配件',quantity:3,unit:'个'}, {...saved.items[0],preparedBy:'forged',recipientId:'b'}]}});
 const result=edited.partsRequests.find(p=>p.ownerId==='a');
 assert.deepEqual(prepared,before);
 assert.deepEqual(result.items[1],saved.items[0]);assert.equal(result.items[0].preparedAt,undefined);
 assert.equal(result.preparedAt,undefined);assert.equal(result.batch,saved.batch);
 assert.deepEqual(edited.partsRequests.find(p=>p.ownerId==='b'),prepared.partsRequests.find(p=>p.ownerId==='b'));
 assert.deepEqual(edited.items,prepared.items);
 for(const items of [[],[{...saved.items[0],quantity:9}], [{...saved.items[0],name:'替换滤芯'}]]) {
   assert.throws(()=>act(prepared,a,'record-parts',{partsRequirement:{mode:items.length?'list':'none',items}}),/已备齐或已出库/);
 }
 assert.throws(()=>act(prepared,b,'record-parts',{partsOwnerId:'a',partsRequirement:parts('覆盖')}),e=>e.status===403);
 assert.throws(()=>applyDispatchAction(edited,{action:'record-parts',expectedVersion:prepared.version,requestId:'stale-edit',partsRequirement:parts('旧编辑')},a,people),e=>e.status===409);
});

test('removing remaining pending parts completes preparation without forging warehouse audit',()=>{
 const initial={...base(),stage:'待开工',items:base().items.map(i=>({...i,status:'待开工'}))};
 const requested=act(initial,a,'record-parts',{partsRequirement:{mode:'list',items:[{name:'滤芯',quantity:1,unit:'个'},{name:'耗材',quantity:2,unit:'片'}]}});
 const prepared=act(requested,w,'confirm-parts',{partsOwnerId:'a',partsPreparation:[{index:0,recipientId:'a'}]});
 const saved=prepared.partsRequests.find(p=>p.ownerId==='a');
 const edited=act(prepared,a,'record-parts',{partsRequirement:{mode:'list',items:[saved.items[0]]}});
 const result=edited.partsRequests.find(p=>p.ownerId==='a');
 assert.equal(result.preparedBy,w.id);assert.equal(result.preparedAt,saved.items[0].preparedAt);
 assert.equal(result.issuedAt,undefined);assert.equal(edited.items[0].status,'维修中');assert.equal(edited.items[1].status,'待开工');
});

test('photo supplements create a new personal batch without resetting peers or original start',()=>{
 let task=act(base(),a,'record-parts',{partsRequirement:{mode:'photo',items:[],photoIds:['first-photo']}});
 task=act(task,b,'record-parts',{partsRequirement:parts('乙的配件')});
 task=act(task,w,'confirm-parts',{partsOwnerId:'a'});
 const before=structuredClone(task),previous=task.partsRequests.find(p=>p.ownerId==='a');
 const next=act(task,a,'record-parts',{partsRequirement:{mode:'photo',items:[],photoIds:['supplement-photo']}});
 const supplement=next.partsRequests.find(p=>p.ownerId==='a');
 assert.equal(supplement.batch,previous.batch+1);assert.equal(supplement.preparedAt,undefined);assert.equal(supplement.preparedBy,undefined);
 assert.deepEqual(supplement.photoIds,['supplement-photo']);assert.equal(supplement.ownerId,'a');
 assert.deepEqual(next.partsRequests.find(p=>p.ownerId==='b'),before.partsRequests.find(p=>p.ownerId==='b'));
 assert.deepEqual(next.items,before.items);assert.equal(next.firstStartedAt,before.firstStartedAt);
 assert.deepEqual(task,before);assert.ok(previous.preparedAt);
 assert.throws(()=>act(next,a,'submit-order'),/确认配件备齐/);
 const prepared=act(next,w,'confirm-parts',{partsOwnerId:'a'});
 assert.equal(act(prepared,a,'submit-order').items[0].status,'待检验');
 assert.equal(prepared.partsRequests.find(p=>p.ownerId==='b').preparedAt,undefined);
});
