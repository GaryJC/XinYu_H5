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

 test('actionable category includes all personal in-progress states and review, with matching search counts',()=>{
 const stages=['待接单','待开工','维修中','暂停','待检验','回审','维修完成'];
 const tasks=stages.map(stage=>({...task(),orderId:stage,stage,technicianIds:['a'],partsRequests:undefined}));
 assert.deepEqual(filterDispatchTasks(tasks,a,{personal:'true',stage:'待处理'}).map(t=>t.stage),['回审','待开工','维修中','暂停']);
 assert.equal(countDispatchTaskStatuses(tasks,a,{personal:'true'})['待处理'],4);
 assert.equal(countDispatchTaskStatuses(tasks,a,{personal:'true',search:'回审'})['待处理'],1);
 assert.equal(own(task('已完工'),a,'待处理').length,0);
 assert.equal(own(task(),b,'待处理').length,1);
 assert.equal(own(task('维修中'),a,'待处理').length,1);
 });

test('assigned date range uses Shanghai inclusive dates across statuses and counts',()=>{
 const dates=['2026-10-31T15:59:59Z','2026-10-31T16:00:00Z','2026-11-01T15:59:59Z','2026-11-01T16:00:00Z',undefined];
 const tasks=dates.map((assignedAt,i)=>({...task('维修中'),orderId:String(i),assignedAt}));
 const query={personal:'true',stage:'待处理',assignedFrom:'2026-11-01',assignedTo:'2026-11-01'};
 assert.deepEqual(filterDispatchTasks(tasks,a,query).map(t=>t.orderId),['1','2']);
 assert.equal(countDispatchTaskStatuses(tasks,a,query)['待处理'],2);
 assert.equal(filterDispatchTasks(tasks,a,{...query,assignedFrom:undefined}).length,3);
 assert.equal(filterDispatchTasks(tasks,a,{...query,assignedTo:undefined}).length,3);
 assert.equal(filterDispatchTasks(tasks,a,{...query,assignedFrom:undefined,assignedTo:undefined}).length,5);
 const completed={...tasks[1],stage:'维修完成',completedAt:'2026-12-02T00:00:00Z'};
 assert.equal(filterDispatchTasks([completed],a,{...query,stage:'已完成'}).length,1);
 assert.throws(()=>filterDispatchTasks(tasks,a,{...query,assignedTo:'2026-10-30'}),e=>e.status===400);
 assert.throws(()=>filterDispatchTasks(tasks,a,{...query,assignedFrom:'2026-02-30'}),e=>e.status===400);
});

 test('actionable review priority is stable before pagination and leaves other categories unchanged',async()=>{
 const {pageResult}=await import('../server/domain/pagination.mjs');
 const working=Array.from({length:22},(_,i)=>({...task('维修中'),orderId:`w${i}`}));
 const review=[0,1].map(i=>({...task('维修中'),stage:'回审',orderId:`r${i}`}));
 const tasks=[...working, ...review],before=structuredClone(tasks);
 const result=filterDispatchTasks(tasks,a,{personal:'true',stage:'待处理'});
 assert.deepEqual(result.map(t=>t.orderId),[...review,...working].map(t=>t.orderId));
 assert.deepEqual(pageResult(result,{page:'1',pageSize:'20'}).items.slice(0,2),review);
 assert.deepEqual(filterDispatchTasks(tasks,a,{personal:'true',includeCompleted:'true'}),tasks);
 assert.deepEqual(tasks,before);
 });

test('actionable ranks review then rework then others, including waiting and paused work',()=>{
 const make=(id,stage,extra={})=>({...task(),orderId:id,technicianIds:['a'],partsRequests:undefined,stage,...extra});
 const tasks=[make('normal','维修中'),make('additional','待开工',{repairRound:2,roundKind:'additional'}),make('legacy','暂停',{rework:true}),make('round','待开工',{repairRound:1}),make('review','回审',{repairRound:1,roundKind:'rework'}),make('paused','暂停'),make('inspection','待检验',{rework:true})];
 const query={personal:'true',stage:'待处理'};
 assert.deepEqual(filterDispatchTasks(tasks,a,query).map(t=>t.orderId),['review','legacy','round','normal','additional','paused']);
 const counts=countDispatchTaskStatuses(tasks,a,query);
 assert.equal(counts['待处理'],counts['回审']+counts['待开工']+counts['维修中']+counts['暂停']);
 assert.equal(own({...task('维修中'),workerPauses:{a:{resumeStage:'维修中'}}},a,'待处理').length,1);
});

test('detailed technician categories preserve personal stages and identify active rework only',()=>{
 const base=(id,stage,extra={})=>({...task(),orderId:id,stage,technicianIds:['a'],partsRequests:undefined,...extra});
 const tasks=[base('waiting','待开工'),base('working','维修中'),base('paused','暂停'),base('legacy','维修中',{rework:true}),base('round','待接单',{repairRound:1}),base('additional','维修中',{repairRound:1,roundKind:'additional'}),base('done','维修完成',{repairRound:1}),base('inspection','待检验',{repairRound:1})];
 const query={personal:'true'};
 assert.deepEqual(filterDispatchTasks(tasks,a,{...query,stage:'返工'}).map(t=>t.orderId),['legacy','round','inspection']);
 const counts=countDispatchTaskStatuses(tasks,a,query);
 assert.equal(counts['待开工'],1);assert.equal(counts['维修中'],3);assert.equal(counts['暂停'],1);assert.equal(counts['返工'],3);
 assert.equal(own({...task('已完工'),repairRound:1},a,'返工').length,0);
 assert.equal(own({...task('维修中'),repairRound:1,workerPauses:{a:{resumeStage:'维修中'}}},a,'暂停').length,1);
 assert.equal(countDispatchTaskStatuses(tasks,a,{...query,search:'legacy'})['返工'],1);
});

test('review and working category only includes personal review or working states',()=>{
 const base=(id,stage)=>({...task(),orderId:id,stage,technicianIds:['a'],partsRequests:undefined});
 const tasks=['待接单','待开工','维修中','暂停','待检验','回审','维修完成'].map(stage=>base(stage,stage));
 const query={personal:'true',stage:'回审&维修中'};
 assert.deepEqual(filterDispatchTasks(tasks,a,query).map(t=>t.orderId),['回审','维修中']);
 const counts=countDispatchTaskStatuses(tasks,a,{personal:'true'});
 assert.equal(counts['回审&维修中'],counts['回审']+counts['维修中']);
 assert.equal(own({...task('维修中'),workerPauses:{a:{resumeStage:'维修中'}}},a,'回审&维修中').length,0);
});
