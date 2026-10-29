import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {isRepairCompleted,repairStatusLabel,repairCategory} from '../shared/repairCompletion.mjs';
import {filterDispatchTasks} from '../server/domain/dispatchTaskFilters.mjs';
const actor={id:'m',role:'manager'};
const task=(id,stage,orderStatus,extra={})=>({orderId:id,plate:id,dispatchNo:id,stage,orderStatus,items:[],...extra});
const tasks=[task('unsettled','维修完成','待结算',{completedAt:'2000-01-01T00:00:00Z'}),task('closed','维修完成','完成'),task('working','维修中','维修中'),task('rework','维修中','待结算',{repairRound:1}),task('review','回审','待结算',{repairRound:1}),task('draft','草稿','草稿')];
test('completed category combines financial statuses and excludes active rework and review',()=>{
 assert.deepEqual(filterDispatchTasks(tasks,actor,{stage:'已完成'}).map(t=>t.orderId),['unsettled','closed']);
 assert.deepEqual(filterDispatchTasks(tasks,actor).map(t=>t.orderId),['working','rework','review','draft']);
 assert.deepEqual(filterDispatchTasks(tasks,actor,{stage:'已完成',from:'2026-01-01',to:'2026-12-31'}).map(t=>t.orderId),['closed']);
 assert.deepEqual(filterDispatchTasks(tasks,actor,{stage:'待结算'}).map(t=>t.orderId),['unsettled'],'legacy API remains compatible');
});
test('legacy status fallback and current stage labels remain consistent',()=>{
 for(const status of ['待结算','完成']){
  assert.equal(isRepairCompleted(undefined,status),true);
  assert.equal(repairStatusLabel(undefined,status),'维修完成');
  assert.equal(repairStatusLabel('回审',status),'回审');
  assert.equal(repairStatusLabel('待开工',status),'待开工');
  assert.equal(repairCategory(status),'已完成');
 }
 assert.equal(repairCategory('维修完成'),'已完成');assert.equal(repairCategory('维修中'),'维修中');
});
const raw=readFileSync(new URL('../client/src/features/dispatch/dispatchLabels.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(raw,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace("from '../../../../shared/repairCompletion.mjs'",`from '${new URL('../shared/repairCompletion.mjs',import.meta.url).href}'`);
const {statusFilters,taskStatusLabel}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
test('dispatch menus remove settlement/closed categories while cards say repair complete',()=>{
 assert.equal(statusFilters.filter(s=>s.label==='已完成').length,1);
 assert.ok(!statusFilters.some(s=>['待结算','已完结'].includes(s.label)));
 assert.equal(taskStatusLabel(tasks[0]),'维修完成');assert.equal(taskStatusLabel(tasks[1]),'维修完成');assert.equal(taskStatusLabel(tasks[4]),'回审');
});

test('archive hydration includes completed stages and mixed-role managers retain unfinished filtering',()=>{
 assert.equal(filterDispatchTasks(tasks,actor,{includeCompleted:'true'}).length,tasks.length);
 assert.deepEqual(filterDispatchTasks(tasks,{...actor,roles:['manager','warehouse']}).map(t=>t.orderId),['working','rework','review','draft']);
});
