import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {applyDispatchAction,validateDispatchRequest} from '../server/domain/dispatchPolicy.mjs';
import {requiredDispatchTechnicians} from '../shared/dispatchTechniciansPolicy.mjs';
const tech={id:'t',name:'原维修工',role:'technician',shopId:'s',active:true};
const spare={...tech,id:'spare',name:'误选员工'};
const added={...tech,id:'added',name:'新增员工'};
const manager={...tech,id:'m',role:'manager'};
const original={orderId:'o',shopId:'s',stage:'维修完成',orderStatus:'待结算',version:2,technicianIds:['t','spare'],technicianId:'t',technicianName:'原维修工、误选员工',completedAt:'2026-10-22T03:00:00Z',workHours:3,items:[{id:1,name:'维修项目',status:'已完工',responsibleId:'t',responsibleName:'原维修工',finishedBy:'t',inspectorName:'检验员'}],workerSubmissions:{t:{at:'2026-10-22T01:00:00Z',note:'已修复'}}};
const input=(patch={})=>({action:'update-technicians',requestId:randomUUID(),expectedVersion:2,technicianIds:['t','added'],...patch});
const apply=(task=original,actor=manager,people=[tech,spare,added],body=input())=>applyDispatchAction(task,body,actor,people);

test('roster correction removes only unused workers and preserves completed repairs',()=>{
  for(const role of ['manager','advisor','inspector']) {
    const next=apply(original,{...manager,role});
    assert.deepEqual(next,{...original,version:3,technicianIds:['t','added'],technicianId:'t',technicianName:'原维修工、新增员工'});
    assert.deepEqual(next.items,original.items);assert.equal(original.technicianIds[1],'spare');
  }
});
test('assigned and submitting workers cannot be removed, including an older submitting owner',()=>{
  for(const patch of [{},{items:[{id:1,status:'已完工',responsibleId:'spare',finishedBy:'t'}]},{items:[],workerSubmissions:{t:{at:'at'}}}]) {
    const task={...original,...patch};
    assert.ok(requiredDispatchTechnicians(task).includes('t'));
    assert.throws(()=>apply(task,manager,undefined,input({technicianIds:['spare']})),/不能移除/);
  }
});
test('only active local technicians can be added; historical inactive owners can remain',()=>{
  for(const person of [{...added,active:false},{...added,shopId:'other'},{...added,role:'inspector'}])assert.throws(()=>apply(original,manager,[tech,spare,person]),/本店有效维修工/);
  assert.equal(apply(original,manager,[{...tech,active:false},added]).technicianIds[0],'t');
});
test('unprivileged actors, other shops, unsettled stages and closed orders cannot edit the roster',()=>{
  for(const actor of [tech,{...manager,active:false},{...manager,shopId:'other'},{...manager,role:'warehouse'}])assert.throws(()=>apply(original,actor));
  for(const patch of [{orderStatus:'完成'},{stage:'待检验'},{executionMode:'outsourced'},{needsReview:true}])assert.throws(()=>apply({...original,...patch}));
  assert.throws(()=>apply(original,manager,undefined,input({expectedVersion:1})),/已更新/);
});
test('roster request rejects empty, duplicate, malformed or unrelated changes',()=>{
  for(const patch of [{technicianIds:[]},{technicianIds:['t','t']},{technicianIds:['t',3]},{technicianIds:undefined},{repairItems:original.items},{dueAt:'2026-10-23T10:00:00Z'},{note:'修改项目'}])assert.throws(()=>validateDispatchRequest(input(patch)));
});
