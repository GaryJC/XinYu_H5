import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDispatchAction} from '../server/domain/dispatchPolicy.mjs';
import {cancelInspectionDeferred} from '../server/domain/inspectionDeferred.mjs';
import {personalRepairStage} from '../shared/repairProgress.mjs';
import {countDispatchTaskStatuses} from '../server/domain/dispatchTaskFilters.mjs';
const tech=id=>({id,name:id,shopId:'s',active:true,role:'technician'});
const a=tech('a'),b=tech('b'),c=tech('c'),m={...tech('m'),role:'manager'},w={...tech('w'),role:'warehouse'},people=[a,b,c,m,w];
const base=()=>({orderId:'o',shopId:'s',plate:'test',dispatchNo:'test',orderStatus:'维修中',stage:'维修中',version:1,acceptedAt:'2026-11-01T00:00:00Z',technicianIds:['a','b'],technicianId:'a',items:[{id:1,name:'甲项目',status:'维修中',responsibleId:'a'},{id:2,name:'乙项目',status:'维修中',responsibleId:'b'}]});
const act=(t,actor,action,extra={})=>applyDispatchAction(t,{action,requestId:'multiworker-regression',expectedVersion:t.version,...extra},actor,people,'2026-11-05T01:00:00Z');
const request=t=>act(t,a,'record-parts',{partsRequirement:{mode:'list',items:[{name:'滤芯',quantity:1,unit:'个'}]}});
const selected={reason:'交班',reassignItemIds:[1],repairItems:[{id:1,name:'甲项目',responsibleId:'c'}]};
test('pending personal material cannot be bypassed by selected, whole or inline reassignment',()=>{
 const t=request(base()),before=structuredClone(t);
 for(const [action,extra] of [['reassign',selected],['reassign',{reason:'交班',technicianIds:['c'],dueAt:'2026-11-08T00:00:00Z'}],['edit-repair-items',{reason:'交班',repairItems:[...selected.repairItems,{id:2,name:'乙项目',responsibleId:'b'}]}]])
  assert.throws(()=>act(t,m,action,extra),e=>e.status===409&&/配件.*改派/.test(e.message));
 assert.deepEqual(t,before);
});
test('unrelated coworker can be reassigned and prepared requests retain their evidence',()=>{
 const t=request(base());
 assert.doesNotThrow(()=>act(t,m,'reassign',{reason:'交班',reassignItemIds:[2],repairItems:[{id:2,name:'乙项目',responsibleId:'c'}]}));
 const ready=act(t,w,'confirm-parts',{partsOwnerId:'a'});
 const moved=act(ready,m,'reassign',selected);
 assert.deepEqual(moved.partsRequests,ready.partsRequests);
 assert.equal(moved.items[0].responsibleId,'c');
});
test('switching through outsourcing cannot discard inherited outstanding personal material',()=>{
 const t=request(base());
 const external=act(t,m,'reassign',{reason:'外包',executionMode:'outsourced',outsourcingMode:'onsite',contractor:'承包方',dueAt:'2026-11-08T00:00:00Z'});
 assert.throws(()=>act(external,m,'reassign',{reason:'转内修',executionMode:'internal',technicianIds:['c'],dueAt:'2026-11-08T00:00:00Z'}),/配件.*改派/);
});
test('warehouse can resolve an unprepared request before reassignment without requiring its absent applicant',()=>{
 const t=request(base());
 const resolved=act(t,w,'edit-parts',{partsOwnerId:'a',partsRequirement:{mode:'none'}});
 assert.doesNotThrow(()=>act(resolved,m,'reassign',selected));
});
test('partially ready and photo applications still require resolution before reassignment',()=>{
 for(const parts of [{mode:'list',items:[{name:'滤芯',preparedAt:'ready'},{name:'皮带'}]},{mode:'photo',photoIds:['photo'],items:[]}]) {
  const t={...base(),partsRequests:[{...parts,ownerId:'a'}]};
  assert.throws(()=>act(t,m,'reassign',selected),/配件.*改派/);
 }
});
test('review submission and inspection project into personal tabs without changing coworker review',()=>{
 let t=act(act(base(),a,'submit-order'),b,'submit-order');
 t=act(t,m,'send-review');
 t=act(t,a,'submit-review');
 assert.equal(t.stage,'回审');assert.equal(personalRepairStage(t,'a'),'待检验');assert.equal(personalRepairStage(t,'b'),'回审');
 let counts=countDispatchTaskStatuses([t],a,{personal:'true'});
 assert.equal(counts['待检验'],1);assert.equal(counts['待处理'],0);assert.equal(counts['回审&维修中'],0);
 t=act(t,m,'inspect');
 assert.equal(t.stage,'回审');assert.equal(personalRepairStage(t,'a'),'维修完成');
 counts=countDispatchTaskStatuses([t],a,{personal:'true'});
 assert.equal(counts['已完成'],1);assert.equal(counts['待处理'],0);
});
test('cancelling last personal item clears only departing worker pause and it does not revive',()=>{
 let t=act(act(base(),a,'pause',{pauseReason:'待客户确认'}),b,'pause',{pauseReason:'待配件'});
 const other=structuredClone(t.workerPauses.b);
 t=cancelInspectionDeferred(t,{itemId:1,inspectionState:'scheduled'},m,'取消项目','2026-11-05T02:00:00Z',people);
 assert.equal(t.workerPauses.a,undefined);assert.deepEqual(t.workerPauses.b,other);
 t=act(t,m,'edit-repair-items',{repairItems:[{id:2,name:'乙项目',responsibleId:'b'},{name:'甲新项目',responsibleId:'a'}]});
 assert.equal(personalRepairStage(t,'a'),'待开工');
 assert.doesNotThrow(()=>act(t,a,'start-order'));
});
test('cancellation keeps pause when the worker still owns another project',()=>{
 const t=base();t.items.push({id:3,name:'甲另一个项目',status:'维修中',responsibleId:'a'});
 const paused=act(t,a,'pause',{pauseReason:'待配件'});
 const next=cancelInspectionDeferred(paused,{itemId:1,inspectionState:'scheduled'},m,'取消项目','2026-11-05T02:00:00Z',people);
 assert.deepEqual(next.workerPauses.a,paused.workerPauses.a);
});

for(const round of [{},{repairRound:1,roundKind:'additional'}])test(`personal rework follows rejected projects in ${round.roundKind||'original'} round`,()=>{
 let task=act(base(),a,'submit-order');Object.assign(task,round);
 task=act(task,m,'inspect',{rejectedItemIds:[1],reason:'需要重新维修'});
 assert.equal(countDispatchTaskStatuses([task],a,{personal:'true'})['返工'],1);
 assert.equal(countDispatchTaskStatuses([task],b,{personal:'true'})['返工'],0);
 assert.equal(countDispatchTaskStatuses([task],b,{personal:'true'})['维修中'],1);
});
test('converting unfinished internal work to outsourced completion does not manufacture inspection',async()=>{
 const {technicianCompletedProjects}=await import('../server/domain/technicianCompletedProjects.mjs');
 let task=act(base(),a,'submit-order');
 task=act(task,m,'reassign',{reason:'外包',executionMode:'outsourced',outsourcingMode:'onsite',contractor:'承包方',dueAt:'2026-11-08T00:00:00Z'});
 task=act(task,m,'complete-outsourced');
 assert.equal(task.items[0].inspectedAt,undefined);
 assert.equal(technicianCompletedProjects([{order_id:'o',round_no:0,snapshot:task}],'a','2026-11').length,0);
 task.items[0].inspectedAt='2026-11-01T00:00:00Z';
 assert.equal(technicianCompletedProjects([{order_id:'o',round_no:0,snapshot:task}],'a','2026-11').length,1);
});
