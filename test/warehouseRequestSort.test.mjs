import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../client/src/features/dispatch/warehouseRequestSort.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
const {sortWarehouseRequests}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const task=(orderId,recordedAt)=>({orderId,partsRequirement:{recordedAt}});
test('warehouse requests sort by application time in either direction without changing source',()=>{
 const tasks=[task('old','2026-10-20T08:00:00Z'),task('new','2026-10-22T08:00:00Z'),task('middle','2026-10-21T08:00:00Z')];
 assert.deepEqual(sortWarehouseRequests(tasks,'newest').map(t=>t.orderId),['new','middle','old']);
 assert.deepEqual(sortWarehouseRequests(tasks,'oldest').map(t=>t.orderId),['old','middle','new']);
 assert.deepEqual(tasks.map(t=>t.orderId),['old','new','middle']);
});
test('missing or invalid dates stay last and tied individual requests preserve their order',()=>{
 const tasks=[task('missing'),task('a','2026-10-22T08:00:00Z'),task('invalid','bad'),task('b','2026-10-22T16:00:00+08:00')];
 for(const direction of ['newest','oldest'])assert.deepEqual(sortWarehouseRequests(tasks,direction).map(t=>t.orderId),['a','b','missing','invalid']);
 assert.deepEqual(sortWarehouseRequests([],'newest'),[]);
});
