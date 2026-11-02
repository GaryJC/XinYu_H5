import test from 'node:test';
import assert from 'node:assert/strict';
import {countDispatchTaskStatuses,filterDispatchTasks} from '../server/domain/dispatchTaskFilters.mjs';
const actor={id:'inspector',active:true,role:'inspector'};
const task=(orderId,stage,extra={})=>({orderId,dispatchNo:orderId,plate:'鲁B12345',stage,orderStatus:'维修中',technicianIds:['tech'],items:[{id:1,responsibleId:'tech',status:stage==='待检验'?'待检验':'维修中'}],...extra});
const tasks=[
 task('inspection','待检验',{urgent:true}),
 task('mixed','维修中',{items:[{id:1,status:'待检验',responsibleId:'tech'},{id:2,status:'维修中',responsibleId:'other'}],urgent:true}),
 task('review','回审',{overdue:true}),
 task('deferred','维修完成',{orderStatus:'完成',inspectionDeferredCount:2,completedAt:'2026-10-20T00:00:00Z'}),
 task('old-completed','维修完成',{completedAt:'2026-09-20T00:00:00Z'}),
 task('other-car','待检验',{plate:'鲁B99999',executionMode:'field',technicianIds:['other']}),
 ...Array.from({length:25},(_,i)=>task(`working-${i}`,'维修中'))
];
test('status counts include all pages and count mixed inspection/deferred orders once',()=>{
 const counts=countDispatchTaskStatuses(tasks,actor,{stage:'待检验',page:'2',pageSize:'20'});
 assert.equal(counts['待检验'],3);
 assert.equal(counts['待定'],1);
 assert.equal(counts['已完成'],2);
 assert.equal(counts['回审'],1);
 assert.equal(counts[''],29);
 assert.equal(counts['待接单'],0);
});
test('badges match each tab after search, urgency, dates, worker and execution filters',()=>{
 for(const query of [{search:'鲁B99999'},{urgent:'true'},{overdue:'true'},{technicianId:'other'},{executionMode:'field'},{from:'2026-10-01',to:'2026-10-31'},{stage:'待检验',metric:'inspection',technicianId:'tech'},{workloadState:'inspection',technicianId:'tech'}]) {
  const counts=countDispatchTaskStatuses(tasks,actor,query);
  for(const [stage,count] of Object.entries(counts))assert.equal(count,filterDispatchTasks(tasks,actor,{...query,stage,metric:undefined,workloadState:undefined}).length);
 }
 assert.equal(countDispatchTaskStatuses(tasks,actor,{from:'2026-10-01',to:'2026-10-31'})['已完成'],1);
 assert.equal(countDispatchTaskStatuses(tasks,actor,{urgent:'true'})['待检验'],2);
 assert.equal(countDispatchTaskStatuses(tasks,actor,{workloadState:'inspection',technicianId:'tech'})['回审'],1);
});
