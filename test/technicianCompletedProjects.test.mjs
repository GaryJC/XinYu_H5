import test from 'node:test';
import assert from 'node:assert/strict';
import { completedProjectMonth, technicianCompletedProjects } from '../server/domain/technicianCompletedProjects.mjs';

const item = (id, responsibleId, inspectedAt, status = '已完工') => ({ id, name: `维修${id}`, responsibleId, inspectedAt, status });
const row = (items, round_no = 0, extra = {}) => ({ order_id: 'order', vehicle_plate: '测试车', dispatch_no: 'A1', round_no, snapshot: { items, ...extra } });

test('month uses Shanghai boundary and validates input', () => {
  assert.equal(completedProjectMonth(undefined, new Date('2026-10-31T16:00:00Z')), '2026-11');
  for (const value of ['2026-13','2026-1','0000-01','invalid']) assert.throws(() => completedProjectMonth(value), { status: 400 });
});
test('counts only own inspected projects even when coworkers or other projects remain unfinished', () => {
  const rows = [row([
    item(1, 'A', '2026-11-03T08:00:00Z'), item(2, 'B', '2026-11-03T08:00:00Z'),
    item(3, 'A', undefined, '待检验'), item(4, 'A', undefined, '维修中')
  ], 0, {stage:'维修中',orderStatus:'维修中',technicianIds:['A','B']})];
  assert.deepEqual(technicianCompletedProjects(rows, 'A', '2026-11').map(p => p.itemId), [1]);
});
test('monthly dates are project inspection dates with inclusive Shanghai start and exclusive end', () => {
  const rows = [row([
    item(1, 'A', '2026-10-31T15:59:59Z'), item(2, 'A', '2026-10-31T16:00:00Z'),
    item(3, 'A', '2026-11-30T15:59:59Z'), item(4, 'A', '2026-11-30T16:00:00Z')
  ], 0, { completedAt: '2026-12-02T00:00:00Z' })];
  assert.deepEqual(technicianCompletedProjects(rows, 'A', '2026-11').map(p => p.itemId), [3,2]);
});
test('historical rounds preserve separate occurrences of the same project', () => {
  const rows = [row([item(1, 'A', '2026-11-01T00:00:00Z')]), row([item(1, 'A', '2026-11-02T00:00:00Z')], 1)];
  assert.deepEqual(technicianCompletedProjects(rows, 'A', '2026-11').map(p => p.key), ['order:1:1','order:0:1']);
});
test('legacy single-worker attribution is allowed, ambiguous owners and unknown dates are excluded', () => {
  const rows = [
    row([item(1, undefined, undefined)], 0, {technicianId:'A', completedAt:'2026-11-01T00:00:00Z'}),
    row([item(2, undefined, '2026-11-01T00:00:00Z')], 1, {technicianIds:['A','B']}),
    row([item(3, 'A', undefined)], 2), row([item(4, 'B', '2026-11-01T00:00:00Z')], 3, {technicianIds:['A']})
  ];
  assert.deepEqual(technicianCompletedProjects(rows, 'A', '2026-11').map(p => p.itemId), [1]);
});

test('legacy completed projects retain their month when new work is added before settlement', async () => {
  const {applyDispatchAction} = await import('../server/domain/dispatchPolicy.mjs');
  const manager = {id:'manager',name:'管理员',role:'manager',active:true,shopId:'shop'};
  const people = ['A','B'].map(id=>({id,name:id,role:'technician',active:true,shopId:'shop'}));
  const task = {orderId:'order',shopId:'shop',stage:'维修完成',orderStatus:'待结算',version:1,technicianId:'A',technicianIds:['A'],completedAt:'2026-10-31T10:00:00Z',items:[{id:1,name:'旧项目',responsibleId:'A',status:'已完工'}]};
  const next = applyDispatchAction(task,{action:'edit-repair-items',requestId:'monthly-review-1',expectedVersion:1,repairItems:[{id:1,name:'旧项目',responsibleId:'A'},{name:'新项目',responsibleId:'B'}]},manager,people,'2026-11-05T00:00:00Z');
  assert.equal(next.completedAt,undefined);
  const data = {...row([]),snapshot:next};
  assert.equal(technicianCompletedProjects([data],'A','2026-10').length,1);
  next.completedAt='2026-11-06T00:00:00Z';
  assert.equal(technicianCompletedProjects([data],'A','2026-11').length,0);
});

test('outsourced completed items use their own finish date before the entire order completes', () => {
  const data=row([{id:1,name:'外包维修',status:'已完工',responsibleId:'A',finishAt:'2026-10-31T10:00:00Z'}],0,{executionMode:'outsourced',completedAt:'2026-11-02T00:00:00Z'});
  assert.equal(technicianCompletedProjects([data],'A','2026-10').length,1);
  assert.equal(technicianCompletedProjects([data],'A','2026-11').length,0);
});

test('same-name projects and the same ID in separate rounds count independently for each owner', () => {
  const original=row([item(1,'A','2026-11-01T00:00:00Z'),item(2,'B','2026-11-01T00:00:00Z')]);
  const addition=row([item(1,'B','2026-11-02T00:00:00Z'),item(-1,'A','2026-11-02T00:00:00Z')],1);
  original.snapshot.items.forEach(item=>item.name='检查');addition.snapshot.items.forEach(item=>item.name='检查');
  assert.deepEqual(technicianCompletedProjects([original,addition],'A','2026-11').map(p=>p.key),['order:1:-1','order:0:1']);
  assert.deepEqual(technicianCompletedProjects([original,addition],'B','2026-11').map(p=>p.key),['order:1:1','order:0:2']);
});

test('order grouping keeps all projects and rounds together before pagination', async () => {
  const {groupCompletedProjectsByOrder}=await import('../server/domain/technicianCompletedProjects.mjs');
  const {pageResult}=await import('../server/domain/pagination.mjs');
  const rows=[row(Array.from({length:25},(_,id)=>item(id,'A','2026-11-01T00:00:00Z'))),row([item(1,'A','2026-11-03T00:00:00Z')],1)];
  for(let i=0;i<20;i++)rows.push({...row([item(1,'A','2026-11-02T00:00:00Z')]),order_id:`other-${i}`});
  const projects=technicianCompletedProjects(rows,'A','2026-11');
  const orders=groupCompletedProjectsByOrder(projects);
  const first=pageResult(orders,{page:1,pageSize:20}),second=pageResult(orders,{page:2,pageSize:20});
  assert.equal(first.total,21);
  assert.equal(first.items[0].projects.length,26);
  assert.equal(new Set(first.items[0].projects.map(p=>p.key)).size,26);
  assert.equal(second.items.length,1);
  assert.equal([...first.items,...second.items].reduce((count,order)=>count+order.projects.length,0),46);
});

test('completion date filters cross month boundaries and sort before grouping/pagination',async()=>{
 const {filterCompletedProjects,groupCompletedProjectsByOrder}=await import('../server/domain/technicianCompletedProjects.mjs');
 const projects=[{key:'old',orderId:'a',completedAt:'2026-10-31T15:59:59.000Z'},{key:'start',orderId:'b',completedAt:'2026-10-31T16:00:00.000Z'},{key:'end',orderId:'a',completedAt:'2026-11-01T15:59:59.000Z'},{key:'next',orderId:'b',completedAt:'2026-11-01T16:00:00.000Z'}];
 const query={from:'2026-11-01',to:'2026-11-01'};
 assert.deepEqual(filterCompletedProjects(projects,query).map(p=>p.key),['end','start']);
 assert.deepEqual(groupCompletedProjectsByOrder(filterCompletedProjects(projects,{...query,sort:'completed-asc'})).map(o=>o.orderId),['b','a']);
 assert.equal(filterCompletedProjects(projects,{from:'2026-11-01'}).length,3);
 assert.equal(filterCompletedProjects(projects,{to:'2026-11-01'}).length,3);
 assert.throws(()=>filterCompletedProjects(projects,{from:'2026-11-02',to:'2026-11-01'}));
 assert.throws(()=>filterCompletedProjects(projects,{sort:'invalid'}));
});
