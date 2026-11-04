import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDispatchAction} from '../server/domain/dispatchPolicy.mjs';
import {personalRepairStage} from '../shared/repairProgress.mjs';

const a={id:'a',name:'甲',role:'technician',shopId:'s',active:true};
const b={...a,id:'b',name:'乙'};
const inspector={...a,id:'i',name:'检验员',role:'inspector'};
const people=[a,b,inspector];
const base=()=>({orderId:'o',shopId:'s',orderStatus:'维修中',stage:'维修中',version:1,acceptedAt:'accepted',technicianIds:['a','b'],technicianId:'a',items:[
  {id:1,name:'甲项目',responsibleId:'a',status:'维修中',startedBy:'a',startAt:'started'},
  {id:2,name:'乙项目',responsibleId:'b',status:'维修中',startedBy:'b',startAt:'started'}
]});
const act=(task,actor,action,extra={})=>applyDispatchAction(task,{action,expectedVersion:task.version,requestId:'state-followup-review',...extra},actor,people,'2026-11-04T01:00:00Z');

for(const inspected of [false,true])test(`a worker cannot pause ${inspected?'inspected':'submitted'} personal work while a coworker is still working`,()=>{
  let task=act(base(),a,'submit-order');
  if(inspected){task=act(task,inspector,'claim-inspection');task=act(task,inspector,'inspect');}
  assert.equal(task.stage,'维修中');
  assert.equal(personalRepairStage(task,a.id),inspected?'维修完成':'待检验');
  const before=structuredClone(task);
  assert.throws(()=>act(task,a,'pause',{pauseReason:'技术问题'}),error=>error.status===409);
  assert.deepEqual(task,before);
});

for(const status of ['待开工','维修中'])test(`a worker with ${status} work can pause without changing a coworkers submitted state`,()=>{
  let task=act(base(),b,'submit-order');
  task.items[0].status=status;
  // A previous personal submission must not prevent pausing a new or returned project.
  task.workerSubmissions.a={at:'previous-submission',note:''};
  const before=structuredClone(task);
  const next=act(task,a,'pause',{pauseReason:'待配件'});
  assert.deepEqual(task,before);
  assert.equal(personalRepairStage(next,a.id),'暂停');
  assert.equal(personalRepairStage(next,b.id),'待检验');
  assert.deepEqual(next.items,before.items);
  assert.deepEqual(next.workerSubmissions,before.workerSubmissions);
  assert.equal(next.workerPauses?.b,undefined);
  assert.equal(next.version,before.version+1);
  const resumed=act(next,a,'resume');
  assert.equal(personalRepairStage(resumed,a.id),status);
});
