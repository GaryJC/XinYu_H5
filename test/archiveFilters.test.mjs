import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { rowToWorkOrder } from '../server/domain/workOrderModel.mjs';
const source = readFileSync(new URL('../client/src/features/workbench/archiveFilters.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { defaultArchiveFilters, archiveTimestamp, archiveBounds, archiveDateError, filterArchiveOrders, archivePerson } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const now = Date.parse('2026-10-22T04:00:00Z');
const filter = patch => ({ ...defaultArchiveFilters(), ...patch });
const order = (id, createdAtIso, extra = {}) => ({ id, createdAtIso, updatedAtIso: createdAtIso, createdAt: '', updatedAt: '', status: '维修中', advisor: '张三', technician: '李四', dispatchNo: 'A123', vehicle: { plate: '鲁B001', vin: '', model: '' }, customer: { name: '车队' }, ...extra });
const results = (orders, patch) => filterArchiveOrders(orders, filter(patch), o => o.displayStatus || o.status, now).map(o => o.id);

test('Beijing natural-day presets and inclusive custom end date', () => {
  const iso = patch => archiveBounds(filter(patch), now).map(n => new Date(n).toISOString());
  assert.deepEqual(iso({range:'today'}), ['2026-10-21T16:00:00.000Z','2026-10-22T16:00:00.000Z']);
  assert.deepEqual(iso({range:'yesterday'}), ['2026-10-20T16:00:00.000Z','2026-10-21T16:00:00.000Z']);
  assert.deepEqual(iso({range:'week'}), ['2026-10-15T16:00:00.000Z','2026-10-22T16:00:00.000Z']);
  assert.deepEqual(iso({range:'custom',from:'2026-09-30',to:'2026-10-01'}), ['2026-09-29T16:00:00.000Z','2026-10-01T16:00:00.000Z']);
  assert.deepEqual(iso({range:'custom',from:'2026-10-22',to:'2026-10-22'}), iso({range:'today'}));
});
test('midnight boundaries use creation time, never update time', () => {
  const orders = [order('before','2026-10-21T15:59:59Z'), order('start','2026-10-21T16:00:00Z'), order('last','2026-10-22T15:59:59Z'), order('next','2026-10-22T16:00:00Z'), order('old','2026-09-01T00:00:00Z',{ updatedAtIso:'2026-10-22T00:00:00Z' })];
  assert.deepEqual(results(orders, {range:'today',sort:'created-asc'}), ['start','last']);
});
test('legacy times parse explicitly; invalid dates and missing dates are excluded only in date filters', () => {
  assert.equal(archiveTimestamp('2026/10/22 00:00:00'), Date.parse('2026-10-21T16:00:00Z'));
  for (const value of ['', 'garbage','2026/02/30 00:00:00','2026/10/22 25:00:00']) assert.ok(Number.isNaN(archiveTimestamp(value)));
  const orders = [order('invalid',''), order('legacy',undefined,{createdAt:'2026/10/22 12:00:00'})];
  assert.deepEqual(results(orders,{range:'today'}), ['legacy']);
  assert.equal(results(orders,{}).length,2);
  assert.ok(archiveDateError(filter({range:'custom',from:'2026-10-23',to:'2026-10-22'})));
  assert.ok(archiveDateError(filter({range:'custom'})));
  assert.equal(archiveDateError(filter({range:'custom',from:'2026-10-22',to:'2026-10-22'})), '');
});
test('OR within groups and AND across groups, display status and unassigned normalization', () => {
  const orders = [order('a','2026-10-22T00:00:00Z',{technician:'待派工',displayStatus:'待开工'}),order('b','2026-10-22T00:00:00Z',{advisor:'王五'}),order('c','2026-10-22T00:00:00Z',{advisor:'赵六'})];
  assert.deepEqual(results(orders,{advisors:['张三','王五'],statuses:['待开工','维修中'],search:' a123 '}),['a','b']);
  assert.deepEqual(results(orders,{technicians:['未分配'],statuses:['待开工']}),['a']);
  assert.deepEqual(results(orders,{search:'not-found'}),[]);
  assert.equal(archivePerson('  '),'未分配');
  assert.deepEqual(results(orders,{search:'a',advisors:['张三']}),['a']);
});
test('four sorts are stable, immutable and put invalid dates last', () => {
  const orders = [order('b','2026-10-21T00:00:00Z'),order('a','2026-10-21T00:00:00Z'),order('new','2026-10-22T00:00:00Z'),order('invalid','bad')];
  for (const field of ['created','updated']) {
    assert.deepEqual(results(orders,{sort:`${field}-desc`}),['new','a','b','invalid']);
    assert.deepEqual(results(orders,{sort:`${field}-asc`}),['a','b','new','invalid']);
  }
  assert.deepEqual(orders.map(o=>o.id),['b','a','new','invalid']);
});
test('server adds canonical ISO times without replacing existing display fields', () => {
  const row = { id:'test', created_at:new Date('2026-10-21T16:00:00Z'), updated_at:new Date('2026-10-22T00:00:00Z') };
  const mapped = rowToWorkOrder(row,[],[],[],[],[],[],[]);
  assert.equal(mapped.createdAtIso,'2026-10-21T16:00:00.000Z');
  assert.equal(mapped.updatedAtIso,'2026-10-22T00:00:00.000Z');
  assert.ok(mapped.createdAt);
});

test('individual technicians match orders with multiple assigned names', () => {
  const orders = [order('team','2026-10-22T00:00:00Z',{technician:'李富强、曲怀复'})];
  assert.deepEqual(results(orders,{technicians:['曲怀复']}),['team']);
  assert.deepEqual(results(orders,{technicians:['李富强']}),['team']);
  assert.deepEqual(results(orders,{technicians:['未分配']}),[]);
});

test('Baiyuan filter excludes unmarked legacy orders and combines with existing filters',()=>{
  const orders=[order('a','2026-10-22T00:00:00Z',{isBaiyuanOrder:true}),order('b','2026-10-22T00:00:00Z'),order('c','2026-10-22T00:00:00Z',{isBaiyuanOrder:true,advisor:'李四'})];
  assert.deepEqual(results(orders,{baiyuanOnly:true}),['a','c']);
  assert.deepEqual(results(orders,{baiyuanOnly:true,advisors:['张三']}),['a']);
  assert.deepEqual(results(orders,{}),['a','b','c']);
});
