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
