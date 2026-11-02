import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOperationsDashboard as build} from '../server/domain/operationsDashboard.mjs';
const now=new Date('2026-11-02T04:00:00Z');
const people=['a','b','idle'].map(id=>({id,name:id,active:true,role:'technician'}));
const task={orderId:'one',plate:'测试',orderStatus:'维修中',stage:'维修中',technicianIds:['a','b'],dueAt:'2026-11-01T00:00:00Z',items:[{id:1,name:'甲项目',responsibleId:'a',status:'待检验',finishAt:'2026-11-02T01:00:00Z'},{id:2,name:'乙项目',responsibleId:'b',status:'维修中'}]};
test('team load follows project ownership, and store vehicle counts are deduplicated',()=>{
 const result=build([task],people,now);const a=result.workers.find(w=>w.id==='a'),b=result.workers.find(w=>w.id==='b');
 assert.equal(result.vehicles,1);assert.equal(a.vehicles,1);assert.equal(b.vehicles,1);assert.equal(a.counts.working,0);assert.equal(a.counts.inspection,1);assert.equal(b.counts.working,1);assert.equal(result.counts.overdue,2);
 assert.equal(result.workers.find(w=>w.id==='idle').counts.unfinished,0);
});
test('personal parts and pauses do not make other workers blocked',()=>{
 const result=build([{...task,workerPauses:{b:{pausedAt:'2026-11-02T02:00:00Z',pauseReason:'等客户'}},partsRequests:[{ownerId:'b',mode:'list',items:[],recordedAt:'2026-11-02T00:00:00Z'}]}],people,now);
 assert.equal(result.workers.find(w=>w.id==='a').counts.parts,0);const b=result.workers.find(w=>w.id==='b');assert.equal(b.counts.parts,1);assert.equal(b.counts.paused,1);assert.equal(b.counts.working,0);
});
test('completed and unsigned work is excluded; unknown owners are not arbitrarily assigned',()=>{
 const result=build([{...task,stage:'维修完成'},{...task,orderStatus:'草稿'},{...task,orderId:'unknown',items:[{id:3,name:'无负责人',status:'待派工'}]}],people,now);
 assert.equal(result.vehicles,1);assert.equal(result.unassigned,1);assert.equal(result.counts.unfinished,1);assert.equal(result.workers.every(w=>w.counts.unfinished===0),true);
});
test('historical owners stay visible but removed roles are not marked assignable',()=>{
 const result=build([task],[{...people[0],role:'employee'},people[1]],now);
 assert.equal(result.workers.find(w=>w.id==='a').assignable,false);assert.equal(result.workers.find(w=>w.id==='a').counts.inspection,1);
});
test('prepared parts are pending outbound and issued parts are no longer a blocker',()=>{
 const base={...task,partsRequests:[{ownerId:'b',mode:'list',items:[],preparedAt:'2026-11-01T00:00:00Z'}]};
 assert.equal(build([base],people,now).counts.pickup,1);base.partsRequests[0].issuedAt='2026-11-02T00:00:00Z';assert.equal(build([base],people,now).counts.pickup,0);
});
test('uncertain historical tasks are counted separately without invented workload',()=>{
 const result=build([{...task,needsReview:true}],people,now);assert.equal(result.uncertain,1);assert.equal(result.projects.length,0);
});
