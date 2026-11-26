import test from 'node:test';
import assert from 'node:assert/strict';
import { onsiteOrders } from '../server/domain/onsiteDashboard.mjs';

const now = new Date('2026-11-26T10:00:00Z');
const people = [{id:'a', name:'刘师傅'}, {id:'b', name:'陈师傅'}];
const task = {
  orderId:'a', dispatchNo:'A', plate:'同车牌', stage:'维修中', orderStatus:'维修中',
  createdAt:'2026-11-19T10:00:00Z', dueAt:'2026-11-25T01:00:00Z',
  items:[
    {id:1, name:'刹车', status:'维修中', responsibleId:'a'},
    {id:2, name:'滤芯', status:'待检验', responsibleId:'b', finishAt:'2026-11-22T01:00:00Z'},
    {id:3, name:'已完工项目', status:'已完工'}
  ]
};
const list = (orders, category, page=1, pageSize=20) => onsiteOrders(orders,people,now,category,page,pageSize);

test('counts orders once within each card, keeps matching projects, and pages same-plate orders by ID', () => {
  const orders = [task, {...task, orderId:'b', createdAt:'2026-11-19T09:59:59.999Z'},
    {...task, orderId:'unsigned', stage:'待客户签字', orderStatus:'待客户签字', createdAt:'2026-11-01T00:00:00Z'}];
  const snapshot = list(orders);
  assert.deepEqual(snapshot.counts, {aged:2, overdue:2, parts:0, inspection:2});
  assert.equal(snapshot.category,'overdue');
  assert.equal(snapshot.items[0].projects.length,2);
  for (const [category,total] of Object.entries(snapshot.counts)) {
    const page1 = list(orders,category,1,1), page2 = list(orders,category,99,1);
    assert.equal(page1.total,total);
    assert.equal(page2.page,Math.max(total,1));
    assert.equal(new Set([...page1.items,...page2.items].map(row=>row.orderId)).size,total);
  }
  assert.deepEqual(list(orders,'aged').items.map(row=>row.orderId), ['unsigned','b']);
  assert.deepEqual(list(orders,'inspection').items[0].projects, [
    {name:'滤芯',ownerName:'陈师傅',waitingSince:'2026-11-22T01:00:00.000Z'}
  ]);
});

test('waiting material clock tracks the applicable unprepared request even during a pause', () => {
  const waiting = {...task, stage:'暂停', workerPauses:{a:{pausedAt:'2026-11-02T00:00:00Z'}},
    partsRequests:[{ownerId:'a',mode:'photo',recordedAt:'2026-11-20T07:00:00Z'},
      {ownerId:'b',mode:'list',recordedAt:'2026-11-01T00:00:00Z'}],
    partsRequirement:{mode:'list',recordedAt:'2026-11-15T00:00:00Z',items:[
      {recipientId:'a',preparedAt:'2026-11-16T00:00:00Z'}, {recipientId:'b'}]}};
  const unknown = {...task, orderId:'unknown', partsRequirement:{mode:'photo'}};
  const external = {...task, orderId:'outside', executionMode:'outsourced', contractor:'汽修厂',
    partsRequests:[{ownerId:'b',mode:'list',recordedAt:'2026-11-19T23:00:00Z'}]};
  const rows = list([unknown,waiting,external],'parts').items;
  assert.deepEqual(rows.map(row=>row.orderId),['outside','a','unknown']);
  assert.deepEqual(rows[1].projects,[{name:'刹车',ownerName:'刘师傅',waitingSince:'2026-11-20T07:00:00.000Z'}]);
  assert.equal(rows[0].projects[0].ownerName,'外包 · 汽修厂');
  assert.equal(rows[2].projects[0].waitingSince,undefined);
  assert.equal(list([waiting],'inspection').items[0].projects[0].waitingSince,new Date(task.items[1].finishAt).toISOString());
});

test('default category chooses overdue, then first nonempty card, including pre-dispatch aged orders', () => {
  const pending = {...task,stage:'待派工',orderStatus:'待派工',createdAt:'2026-11-17T00:00:00Z',dueAt:undefined,items:[]};
  assert.equal(list([pending]).category,'aged');
  assert.equal(list([{...task,dueAt:now.toISOString()}]).category,'inspection');
  assert.deepEqual(list([]).counts,{aged:0,overdue:0,parts:0,inspection:0});
  assert.equal(list([]).category,'overdue');
});
