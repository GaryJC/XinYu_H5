import test from 'node:test';
import assert from 'node:assert/strict';
import {analyticsOrderPage, analyticsPeriod, buildBusinessAnalytics as build} from '../server/domain/businessAnalytics.mjs';
const now=new Date('2026-11-02T04:00:00Z');
const order=(id,createdAt,extra={})=>({id,createdAt,status:'维修中',plate:id,customer:'车队',completionDates:[],...extra});
const run=rows=>build(rows,{days:7,now});
test('Shanghai complete days have adjacent equal comparison periods and exclude today',()=>{
 const r=run([order('start','2026-10-25T16:00:00Z'),order('prev','2026-10-25T15:59:59Z'),order('last','2026-11-01T15:59:59Z'),order('today','2026-11-01T16:00:00Z')]);
 assert.deepEqual(r.range,{days:7,from:'2026-10-26',to:'2026-11-01',previousFrom:'2026-10-19',previousTo:'2026-10-25'});
 assert.equal(r.kpis.orders.value,2);assert.equal(r.kpis.orders.previous,1);assert.equal(r.kpis.orders.change,100);
 assert.equal(r.daily.length,7);assert.equal(r.daily[0].created,1);assert.equal(r.daily[6].created,1);
});
test('first completion is deduplicated across rounds and later rework does not count twice',()=>{
 const r=run([order('a','2026-10-20T00:00:00Z',{completionDates:['2026-10-27T00:00:00Z','2026-10-29T00:00:00Z','2026-10-27T00:00:00Z']}),order('b','2026-10-01',{completionDates:['2026-10-22','2026-10-28']})]);
 assert.equal(r.kpis.completed.value,1);assert.equal(r.kpis.completed.previous,1);assert.equal(r.kpis.cycleDays.value,7);
});
test('excludes drafts, unprocessed paper orders and invalid creation dates',()=>{
 const r=run([order('draft','2026-10-28',{status:'草稿'}),order('paper','2026-10-28',{status:'待处理纸质委托书'}),order('bad','bad-date')]);
 assert.equal(r.kpis.orders.value,0);assert.equal(r.quality.invalidCreated,1);assert.equal(r.monthly.reduce((s,r)=>s+r.value,0),0);
});
test('zero baselines never invent an infinite growth rate and missing cycle data stays null',()=>{
 const r=run([order('a','2026-10-28',{stage:'维修完成'})]);
 assert.deepEqual(r.kpis.orders,{value:1,previous:0,change:null});assert.equal(r.kpis.cycleDays.value,null);assert.equal(r.quality.missingCompletion,1);
 assert.equal(r.liveCount,0);
});
test('vehicle history deduplicates VIN and uniquely mapped historical plate-only records',()=>{
 const r=run([order('old','2026-08-01',{plate:'鲁B12345'}),order('new','2026-10-28',{vin:'VIN-A',plate:'鲁B12345'}),order('repeat','2026-10-29',{vin:'vin-a',plate:'鲁B12345'}),order('noid','2026-10-28',{plate:''})]);
 assert.equal(r.kpis.vehicles.value,1);assert.deepEqual(r.vehicleMix,[{name:'首次记录车辆',value:0},{name:'历史到店车辆',value:1}]);assert.equal(r.quality.missingVehicle,1);
});
test('cycle histogram, snapshot status, customer totals and execution modes reconcile',()=>{
 const r=run([order('a','2026-10-28T00:00:00Z',{completionDates:['2026-10-29T00:00:00Z'],stage:'维修完成',executionMode:'field'}),order('b','2026-10-29T00:00:00Z',{completionDates:['2026-11-01T00:00:00Z'],status:'完成'}),order('c','2026-10-30',{status:'待客户签字',stage:'待派工'})]);
 assert.equal(r.kpis.cycleDays.value,2);assert.deepEqual(r.cycleBuckets.map(r=>r.value),[1,1,0,0]);
 assert.equal(r.liveCount,1);assert.equal(r.aging.reduce((s,r)=>s+r.value,0),1);
 assert.equal(r.status.find(r=>r.name==='待客户签字').value,1);assert.equal(r.execution.find(r=>r.name==='员工外修').value,1);
 assert.equal(r.customers.reduce((s,r)=>s+r.value,0),3);
});
test('12-month trend crosses years and explicitly marks the unfinished month',()=>{
 const r=run([order('a','2025-12-01'),order('b','2026-11-02T00:00:00Z')]);
 assert.equal(r.monthly.length,12);assert.equal(r.monthly[0].month,'2025-12');assert.equal(r.monthly[0].value,1);assert.deepEqual(r.monthly[11],{month:'2026-11',value:1,partial:true});
});
test('invalid and pre-creation completion timestamps do not produce negative cycle times',()=>{
 const r=run([order('a','2026-10-28',{stage:'维修完成',completionDates:['bad','2026-10-20','2027-01-01']})]);
 assert.equal(r.kpis.completed.value,0);assert.equal(r.kpis.cycleDays.samples,0);assert.equal(r.quality.missingCompletion,1);
});

test('current month includes all completed Shanghai days but short-month growth uses matching days', () => {
  const now = new Date('2026-03-30T16:01:00Z');
  const rows = [
    order('baseline', '2026-02-28T15:59:59Z', {completionDates:['2026-02-28T15:59:59Z']}),
    order('early', '2026-02-28T16:00:00Z', {completionDates:['2026-03-02T16:00:00Z']}),
    order('late', '2026-03-28T16:00:00Z', {completionDates:['2026-03-29T16:00:00Z']}),
    order('today', '2026-03-30T16:00:00Z')
  ];
  const result = build(rows, {month:'2026-03', now});
  assert.deepEqual(result.range, {month:'2026-03', days:30, from:'2026-03-01', to:'2026-03-30',
    previousFrom:'2026-02-01', previousTo:'2026-02-28', comparableTo:'2026-03-28'});
  for (const key of ['orders', 'vehicles', 'completed']) {
    assert.deepEqual(result.kpis[key], {value:2, previous:1, comparableValue:1, change:0});
  }
  assert.deepEqual(result.kpis.cycleDays, {value:1.5, previous:0, comparableValue:2, samples:2});
  assert.equal(result.daily.at(-3).previous, 1);
  assert.equal(result.daily.at(-2).previous, null);
  assert.equal(result.daily.at(-1).previousDate, '');
  assert.deepEqual(result.monthly.at(-1), {month:'2026-03', value:2, partial:true});
});

test('closed months compare to the entire previous month across leap years and year boundaries', () => {
  const february = build([
    order('jan', '2024-01-31T15:59:59Z'), order('feb', '2024-02-29T15:59:59Z'),
    order('march', '2024-02-29T16:00:00Z')
  ], {month:'2024-02', now});
  assert.deepEqual(february.range, {month:'2024-02', days:29, from:'2024-02-01', to:'2024-02-29',
    previousFrom:'2024-01-01', previousTo:'2024-01-31', comparableTo:'2024-02-29'});
  assert.deepEqual(february.kpis.orders, {value:1, previous:1, comparableValue:1, change:0});
  assert.equal(february.daily.at(-1).created, 1);
  assert.deepEqual(february.monthly.at(-1), {month:'2024-02', value:1, partial:false});
  assert.equal(february.monthly[0].month, '2023-03');
  assert.equal(build([], {month:'2026-01', now}).range.previousFrom, '2025-12-01');
});

test('first day in Shanghai gives a zero-day latest report and invalid months fail validation', () => {
  const now = new Date('2026-10-31T16:00:00Z');
  const rows = [order('oct', '2026-10-31T15:59:59Z'), order('nov', now)];
  const result = build(rows, {month:'2026-11', now});
  assert.deepEqual(result.range, {month:'2026-11', days:0, from:'2026-11-01', to:'',
    previousFrom:'2026-10-01', previousTo:'', comparableTo:''});
  assert.deepEqual(result.kpis.orders, {value:0, previous:0, comparableValue:0, change:null});
  assert.deepEqual(result.daily, []);
  assert.deepEqual(result.monthly.at(-1), {month:'2026-11', value:0, partial:true});
  assert.equal(result.monthly.at(-2).value, 1);
  for (const month of ['2026-12', '2026-00', '2026-13', '2026-1', '2026-10-01', '', null]) {
    assert.throws(() => build([], {month, now}), error => error.status === 400);
  }
});

test('monthly drilldowns use the KPI cohort, earliest valid completion and stable pages', () => {
  const opts = {month:'2026-10', now};
  const period = analyticsPeriod(opts, now);
  const rows = [
    order('z', '2026-10-01', {dispatchNo:'A-z', stage:'维修中', completionDates:['bad','2026-09-29','2026-10-29','2026-11-01']}),
    order('a', '2026-10-01', {status:'待客户签字', completionDates:['2026-10-29']}),
    order('old', '2026-09-01', {status:'完成', completionDates:['2026-09-30', '2026-10-30']}),
    order('prior', '2026-09-01', {completionDates:['2026-10-28']}),
    order('draft', '2026-10-28', {status:'草稿', completionDates:['2026-10-29']})
  ];
  const report = build(rows, opts);
  for (const [metric, ids] of [['orders',['a','z']], ['completed',['a','z','prior']]]) {
    const options = {metric, pageSize:1};
    const pages = ids.map((_, index) => analyticsOrderPage(rows, {...options, page:index+1}, period, now));
    assert.equal(pages[0].total, report.kpis[metric].value);
    assert.deepEqual(pages.map(p => p.items[0].id), ids);
    assert.equal(analyticsOrderPage(rows, {...options, page:99}, period, now).page, ids.length);
    assert.equal(pages[0].items[0].stage, '待客户签字');
    assert.equal(pages[1].items[0].dispatchNo, 'A-z');
    assert.equal(pages[1].items[0].firstCompletedAt, '2026-10-29T00:00:00.000Z');
  }
});
