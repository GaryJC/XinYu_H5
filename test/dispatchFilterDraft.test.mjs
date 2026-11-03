import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../client/src/features/dispatch/useDispatchFilterDraft.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace("from 'react'",`from '${import.meta.resolve('react')}'`);
const {advancedFilterCount,activeFilterCount,filterDateError,searchAllFilters,selectStatusFilters}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
test('advanced filter badge counts execution choices as a group and a date range as a group',()=>{
 assert.equal(advancedFilterCount({}),0);
 assert.equal(advancedFilterCount({executionMode:'internal,field',from:'2026-10-01',to:'2026-10-31'}),2);
 assert.equal(advancedFilterCount({technicianId:'t',to:'2026-10-31'}),2);
 assert.equal(activeFilterCount({stage:'待检验',urgent:'true',overdue:'true',search:'A67527',executionMode:'internal,field'}),5);
});
test('date range accepts open bounds without injecting month defaults and rejects reversed dates',()=>{
 for(const filters of [{},{from:'2026-10-01'},{to:'2026-10-31'},{from:'2026-10-01',to:'2026-10-01'}])assert.equal(filterDateError(filters),'');
 assert.match(filterDateError({from:'2026-10-31',to:'2026-10-01'}),/开始日期不能晚于结束日期/);
});


test('new search clears old filters, includes completed tasks and supports subsequent narrowing',async()=>{
 const {filterDispatchTasks,countDispatchTaskStatuses}=await import('../server/domain/dispatchTaskFilters.mjs');
 const actor={id:'a',role:'inspector',shopId:'s'};
 const tasks=[
  {orderId:'o1',plate:'鲁B12345',dispatchNo:'A1',stage:'维修中',orderStatus:'维修中',items:[],urgent:true},
  {orderId:'o2',plate:'鲁B12345',dispatchNo:'A2',stage:'维修完成',orderStatus:'完成',items:[],completedAt:'2025-01-01T00:00:00Z'},
  {orderId:'o3',plate:'鲁B99999',dispatchNo:'A3',stage:'待检验',orderStatus:'维修中',items:[{status:'待检验'}]}
 ];
 const search=searchAllFilters('  鲁B12345  ');
 assert.deepEqual(search,{search:'鲁B12345',includeCompleted:'true'});
 assert.deepEqual(filterDispatchTasks(tasks,actor,search).map(t=>t.orderId),['o1','o2']);
 const counts=countDispatchTaskStatuses(tasks,actor,search);
 assert.equal(counts.all,2);assert.equal(counts[''],1);assert.equal(counts['已完成'],1);
 assert.deepEqual(filterDispatchTasks(tasks,actor,selectStatusFilters(search,'已完成')).map(t=>t.orderId),['o2']);
 assert.deepEqual(filterDispatchTasks(tasks,actor,selectStatusFilters(search,'')).map(t=>t.orderId),['o1']);
 assert.equal(filterDispatchTasks(tasks,actor,selectStatusFilters(search,'待检验')).length,0);
 assert.deepEqual(filterDispatchTasks(tasks,actor,{...search,urgent:'true'}).map(t=>t.orderId),['o1']);
 assert.deepEqual(searchAllFilters('  '),{});
});
