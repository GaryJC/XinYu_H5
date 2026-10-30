import test from 'node:test';
import assert from 'node:assert/strict';
import { pagination,pageResult } from '../server/domain/pagination.mjs';
import {warehouseRequests,matchesPartsStatus,sortWarehouseRequests} from '../shared/warehouseRequests.mjs';
test('pagination rejects invalid or unbounded requests',()=>{
  for(const page of ['0','-1','1.5','1e3','abc','1000001'])assert.throws(()=>pagination({page}),e=>e.status===400);
  for(const pageSize of ['0','101','Infinity'])assert.throws(()=>pagination({pageSize}),e=>e.status===400);
  assert.deepEqual(pageResult([],{page:'8'}),{items:[],total:0,page:1,pageSize:20});
  const result=pageResult(Array.from({length:21},(_,i)=>i),{page:'8'});assert.equal(result.page,2);assert.deepEqual(result.items,[20]);
});
test('warehouse pagination units are requests, with full counts before paging',()=>{
  const tasks=[{orderId:'a',stage:'维修中',acceptedAt:'yes',partsRequests:[{ownerId:'one',mode:'list',items:[{}],recordedAt:'2026-10-30T00:00:00Z'},{ownerId:'two',mode:'list',items:[{preparedAt:'yes'},{}],recordedAt:'2026-10-30T01:00:00Z'}]},
    {orderId:'b',stage:'维修中',acceptedAt:'yes',partsRequirement:{mode:'photo',preparedAt:'yes',items:[]}}];
  const rows=warehouseRequests(tasks);assert.equal(rows.length,3);
  assert.equal(rows.filter(t=>matchesPartsStatus(t,'待备料')).length,1);
  assert.equal(rows.filter(t=>matchesPartsStatus(t,'部分备齐')).length,1);
  assert.equal(rows.filter(t=>matchesPartsStatus(t,'备料完成')).length,1);
  assert.equal(sortWarehouseRequests(rows,'newest')[0].partsRequirement.ownerId,'two');
});
