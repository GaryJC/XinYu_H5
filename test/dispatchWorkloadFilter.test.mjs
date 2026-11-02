import test from 'node:test';
import assert from 'node:assert/strict';
import {filterDispatchTasks} from '../server/domain/dispatchTaskFilters.mjs';
import {buildOperationsDashboard} from '../server/domain/operationsDashboard.mjs';
const actor={id:'manager',active:true,role:'manager'};
const item=(id,responsibleId,status)=>({id,responsibleId,name:`项目${id}`,status});
const task=(orderId,items,extra={})=>({orderId,plate:orderId,dispatchNo:orderId,stage:'维修中',orderStatus:'维修中',technicianIds:['a','b'],items,...extra});
const tasks=[task('mixed',[item(1,'a','待检验'),item(2,'b','维修中'),item(3,'a','待检验')]),task('paused',[item(4,'a','维修中'),item(5,'b','维修中')],{workerPauses:{a:{pauseReason:'等配件'}}}),task('pending',[item(6,'a','待开工')],{stage:'待接单'}),task('finished',[item(7,'a','已完工')],{stage:'维修完成'}),task('draft',[item(8,'a','待开工')],{orderStatus:'草稿'}),task('uncertain',[item(9,'a','待开工')],{needsReview:true})];
const select=(worker,state,source=tasks)=>filterDispatchTasks(source,actor,{technicianId:worker,workloadState:state});
test('chart clicks select the personal item state, not the team stage',()=>{
 assert.deepEqual(select('a','inspection').map(t=>t.orderId),['mixed']);
 assert.deepEqual(select('a','working'),[]);
 assert.deepEqual(select('b','working').map(t=>t.orderId),['mixed','paused']);
 assert.deepEqual(select('a','paused').map(t=>t.orderId),['paused']);
 assert.deepEqual(select('a','waiting').map(t=>t.orderId),['pending']);
});
test('multiple matching projects are returned as one order and agree with chart classification',()=>{
 const board=buildOperationsDashboard(tasks,[]);
 for(const worker of ['a','b'])for(const state of ['working','waiting','paused','inspection','unfinished']){
  const expected=[...new Set(board.projects.filter(p=>p.ownerId===worker&&p.flags.includes(state)).map(p=>p.orderId))].sort();
  assert.deepEqual(select(worker,state).map(t=>t.orderId).sort(),expected);
 }
 assert.equal(board.workers.find(w=>w.id==='a').counts.inspection,2);assert.equal(select('a','inspection').length,1);
});
test('zero loads, historical owners and unnamed owners are handled without guessing',()=>{
 assert.deepEqual(select('idle','unfinished'),[]);
 const historical=[task('historical',[item(1,'removed','维修中')])];
 assert.equal(select('removed','working',historical).length,1);
 assert.equal(select('a','working',[task('unowned',[item(1,undefined,'维修中')])]).length,0);
});
test('reject malformed workload filters and continue respecting ordinary search filters',()=>{
 assert.throws(()=>filterDispatchTasks(tasks,actor,{workloadState:'bad',technicianId:'a'}),{status:400});
 assert.throws(()=>filterDispatchTasks(tasks,actor,{workloadState:'working'}),{status:400});
 assert.deepEqual(filterDispatchTasks(tasks,actor,{workloadState:'working',technicianId:'b',search:'paused'}).map(t=>t.orderId),['paused']);
});
