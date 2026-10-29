import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDispatchAction} from '../server/domain/dispatchPolicy.mjs';
const a={id:'a',name:'甲',role:'technician',shopId:'s',active:true},b={...a,id:'b',name:'乙'},c={...a,id:'c',name:'丙'},i={...a,id:'i',role:'inspector'};
const people=[a,b,c,i];
const task=()=>({orderId:'o',shopId:'s',orderStatus:'待结算',stage:'维修完成',version:1,technicianIds:['b','c'],technicianId:'b',items:[a,b,c].map((person,index)=>({id:index+1,name:`项目${index+1}`,status:'已完工',responsibleId:person.id,responsibleName:person.name,startedBy:person.id,finishedBy:person.id}))});
const act=(t,actor,action,roster=people)=>applyDispatchAction(t,{action,expectedVersion:t.version,requestId:'review-handover-test'},actor,roster);
test('review restores active historical project owners removed by whole-task reassignment',()=>{
 const original=task();let next=act(original,i,'send-review');
 assert.ok(next.technicianIds.includes('a'));
 assert.match(next.technicianName,/甲/);
 for(const actor of [a,b,c])next=act(next,actor,'submit-review');
 assert.equal(next.stage,'待检验');assert.equal(original.stage,'维修完成');
});
test('review rejects invalid historical owners before unlocking completed work',()=>{
 for(const patch of [{active:false},{role:'advisor'},{shopId:'other'}]) {
  const original=task(),before=structuredClone(original);
  assert.throws(()=>act(original,i,'send-review',[{...a,...patch},b,c,i]),e=>e.status===409);
  assert.deepEqual(original,before);
 }
});
test('legacy external contractor review finishes internally without another inspection',()=>{
 const advisor={...a,id:'advisor',role:'advisor'};
 for(const stage of ['待检验','回审']) {
  const original={...task(),stage,executionMode:'outsourced',contractor:'历史承包方',outsourcingMode:'offsite',technicianIds:[],technicianId:undefined,items:[{id:1,name:'外包维修',status:'待检验'}]};
  assert.throws(()=>act(original,i,'send-review',[advisor,i]),/外包无需提检/);
  const next=act(original,advisor,'complete-outsourced',[advisor,i]);
  assert.equal(next.stage,'维修完成');assert.equal(next.items[0].finishedBy,advisor.id);assert.equal(next.items[0].inspectedAt,undefined);
 }
});

test('scheduler cannot submit internal review or use removed external submission',()=>{
 const advisor={...a,id:'advisor',role:'advisor'};
 assert.throws(()=>act({...task(),stage:'回审'},advisor,'submit-review',[...people,advisor]),e=>e.status===403);
 assert.throws(()=>act({...task(),executionMode:'outsourced',contractorId:'a',stage:'回审'},advisor,'submit-review',[...people,advisor]),/外包无需提检/);
});
test('review excludes roster-only workers so every reviewed project can reach inspection',()=>{
 const original={...task(),items:task().items.filter(item=>item.responsibleId!=='c')};
 const before=structuredClone(original);
 let next=act(original,i,'send-review');
 assert.deepEqual(new Set(next.technicianIds),new Set(['a','b']));
 for(const actor of [a,b])next=act(next,actor,'submit-review');
 assert.equal(next.stage,'待检验');
 next=act(next,i,'claim-inspection');next=act(next,i,'inspect');
 assert.equal(next.stage,'维修完成');assert.deepEqual(original,before);
 assert.ok(next.participantIds.includes('c'));
 assert.throws(()=>act(next, {...c,role:'inspector'}, 'send-review'),e=>e.status===403);
});
