import test from 'node:test';
import assert from 'node:assert/strict';
import {filterDispatchTasks,countDispatchTaskStatuses} from '../server/domain/dispatchTaskFilters.mjs';
import {warehouseRequests,matchesPartsStatus} from '../shared/warehouseRequests.mjs';

const a={id:'a',role:'technician',active:true},b={...a,id:'b'},inspector={...a,id:'i',role:'inspector'},warehouse={...a,id:'w',role:'warehouse'};
const now='2026-11-04T04:00:00Z';
const task=(aStatus='待检验')=>({orderId:'mixed',dispatchNo:'mixed',plate:'鲁B测试',orderStatus:'维修中',stage:'维修中',technicianIds:['a','b'],acceptedAt:now,
 items:[{id:1,responsibleId:'a',status:aStatus,inspectedAt:aStatus==='已完工'?now:undefined},{id:2,responsibleId:'b',status:'待开工'}],workerSubmissions:{a:{at:now}},
 partsRequests:[{ownerId:'a',mode:'list',items:[{name:'滤芯',preparedAt:now},{name:'刹车片',preparedAt:now}],preparedAt:now},{ownerId:'b',mode:'list',items:[{name:'皮带'}]}]});
const own=(t,user,stage,extra={})=>filterDispatchTasks([t],user,{personal:'true',technicianId:user.id,stage,...extra});

test('personal categories and badges classify only the authenticated worker while returning the original task',()=>{
 const t=task(),before=structuredClone(t);
 assert.deepEqual(own(t,a,'待检验'),[t]);assert.equal(own(t,a,'进行中').length,0);
 assert.deepEqual(own(t,b,'进行中'),[t]);assert.equal(own(t,b,'待检验').length,0);
 const counts=countDispatchTaskStatuses([t],a,{personal:'true',technicianId:'a'});
 assert.equal(counts['待检验'],1);assert.equal(counts['维修中'],0);assert.equal(counts['待开工'],0);
 assert.deepEqual(t,before);assert.equal(own(t,b,'进行中')[0],t);
});
test('personal completion uses that worker’s inspection date before whole-order completion',()=>{
 const t=task('已完工');
 assert.equal(own(t,a,'进行中').length,0);assert.equal(own(t,a,'已完成').length,1);
 assert.equal(own(t,a,'已完成',{from:'2026-11-01',to:'2026-11-30'}).length,1);
 assert.equal(own(t,a,'已完成',{from:'2026-10-01',to:'2026-10-31'}).length,0);
 assert.equal(own(t,{...a,roles:['technician','warehouse']},'已完成',{from:'2026-10-01',to:'2026-10-31'}).length,0);
 assert.equal(own(t,b,'已完成').length,0);assert.equal(own(t,b,'进行中').length,1);
});
test('personal pauses and legacy unsubmitted work do not become a coworker’s pending inspection',()=>{
 const t=task();t.workerPauses={b:{resumeStage:'待开工'}};
 assert.equal(own(t,b,'暂停').length,1);assert.equal(own(t,a,'暂停').length,0);
 delete t.workerSubmissions;
 assert.equal(own(t,a,'进行中').length,1);assert.equal(own(t,a,'待检验').length,0);
 t.stage='回审';assert.equal(own(t,a,'回审').length,1);
 t.stage='暂停';assert.equal(own(t,a,'暂停').length,1);
 t.stage='待检验';t.needsReview=true;assert.equal(own(t,a,'待检验').length,0);
});
test('inspector, manager worker filters and warehouse requests keep whole-order semantics',()=>{
 for(const actor of [inspector,{...inspector,role:'manager'}]) {
  assert.equal(filterDispatchTasks([task()],actor,{technicianId:'b',stage:'待检验'}).length,1);
  assert.equal(filterDispatchTasks([task('已完工')],actor,{stage:'已完成'}).length,0);
 }
 for(const status of ['待检验','已完工']) {
  const requests=warehouseRequests(filterDispatchTasks([task(status)],warehouse));
  assert.equal(requests.filter(t=>matchesPartsStatus(t,'待备料')).length,1);
  assert.equal(requests.filter(t=>matchesPartsStatus(t,'备料完成')).length,1);
 }
 assert.throws(()=>own(task(),a,'进行中',{technicianId:'b'}),e=>e.status===403);
 assert.throws(()=>own(task(),warehouse,'进行中'),e=>e.status===403);
});
