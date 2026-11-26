import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {analyticsOrderPage, analyticsPeriod, buildBusinessAnalytics} from '../server/domain/businessAnalytics.mjs';

const url = process.env.BUSINESS_ANALYTICS_TEST_DATABASE_URL;
test('monthly shop-scoped detail counts reconcile with report across events, rounds and legacy snapshots', {skip:!url}, async () => {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname));
  process.env.DATABASE_URL = url;
  const {readBusinessAnalyticsOrders: read} = await import('../server/repositories/businessAnalyticsRepository.mjs');
  const {businessAnalytics, businessAnalyticsOrders} = await import('../server/services/businessAnalyticsService.mjs');
  const actor = {shopId:'a', role:'manager', active:true};
  await assert.rejects(() => businessAnalytics({...actor, role:'technician'}, 30), error => error.status === 403);
  await assert.rejects(() => businessAnalyticsOrders({...actor, active:false}), error => error.status === 403);
  for (const query of [{}, {month:'2026-x',metric:'orders'}, {month:'2024-10',metric:'vehicles'}, {month:'2024-10',metric:'completed',pageSize:'101'}]) {
    await assert.rejects(() => businessAnalyticsOrders(actor, query), error => error.status === 400);
  }
  const db = new pg.Client({connectionString:url});
  await db.connect();
  try {
    await db.query('begin');
    await db.query(`create temporary table work_orders(id text primary key, shop_id text, created_at timestamptz,
      status text, dispatch_no text, customer_name text, vehicle_plate text, vehicle_vin text) on commit drop`);
    await db.query('create temporary table dispatch_tasks(order_id text primary key, shop_id text, stage text, data jsonb) on commit drop');
    await db.query('create temporary table dispatch_events(order_id text, at timestamptz, detail jsonb) on commit drop');
    await db.query('create temporary table dispatch_repair_rounds(order_id text, completed_at timestamptz, snapshot jsonb) on commit drop');
    await db.query(`insert into work_orders(id,shop_id,created_at,status,dispatch_no,vehicle_plate) values
      ('event','a','2024-10-02','完成','B001','鲁B1'), ('round','a','2024-08-01','完成','B002','鲁B2'),
      ('legacy','a','2024-09-01','完成','B003','鲁B3'), ('rework','a','2024-08-02','维修中','B004','鲁B4'),
      ('bad','a','2024-10-02','完成','B005','鲁B5'), ('draft','a','2024-10-02','草稿','B006','鲁B6'),
      ('other','b','2024-10-02','完成','B007','鲁B7'), ('new','a','2024-10-31T15:59:59Z','待客户签字','B008','鲁B8'),
      ('wrong-task','a','2024-10-15','维修中','B009','鲁B9'), ('archived','a','2024-08-01','完成','B010','鲁B10')`);
    await db.query(`insert into dispatch_tasks values
      ('event','a','维修完成','{}'), ('legacy','a','维修完成','{"completedAt":"2024-10-01T00:00:00+08:00"}'), ('round','a','维修完成','{"completedAt":"2024-12-01"}'),
      ('rework','a','维修中','{"completedAt":"2024-10-25"}'), ('bad','a','维修完成','{"completedAt":"invalid"}'),
      ('wrong-task','b','维修完成','{"completedAt":"2024-10-22","executionMode":"outsourced"}')`);
    await db.query(`insert into dispatch_events(order_id,at,detail) values
      ('event','2024-09-01','{"stage":"维修完成"}'), ('event','2024-10-12','{"stage":"维修完成"}'),
      ('wrong-task','2024-10-22','{"stage":"维修完成"}'), ('event','2024-10-02','{"stage":"维修中"}'), ('rework','2024-09-02','{"stage":"维修完成"}')`);
    await db.query(`insert into dispatch_repair_rounds values
      ('round','2024-07-01','{}'), ('round','2024-10-22','{"shopId":"a"}'),
      ('round','2024-09-01','{"shopId":"b"}'), ('archived','2024-10-12','{}'),
      ('rework','2024-10-30','{}'), ('other','2024-10-05','{}'), ('wrong-task','2024-10-22','{}')`);
    const now = new Date('2024-11-02T00:00:00Z');
    const opts = {month:'2024-10', now};
    const period = analyticsPeriod(opts, now);
    const report = buildBusinessAnalytics(await read(actor, db), opts);
    assert.equal(report.kpis.orders.value, 4);
    assert.equal(report.kpis.completed.value, 4);
    const misplacedDetail = analyticsOrderPage(await read(actor, db, {...period, metric:'orders'}),
      {metric:'orders', page:1, pageSize:20}, period, now).items.find(row => row.id === 'wrong-task');
    assert.equal(misplacedDetail.stage, '维修中');
    assert.equal(misplacedDetail.firstCompletedAt, null);
    assert.ok(!report.execution.some(bucket => bucket.name === '外包维修'));
    assert.equal(report.quality.missingCompletion, 1);
    for (const [metric, ids] of [['orders',['new','wrong-task','bad','event']], ['completed',['round','archived','event','legacy']]]) {
      const candidates = await read(actor, db, {...period, metric});
      const count = report.kpis[metric].value;
      const result = ids.map((_, i) => analyticsOrderPage(candidates, {metric, page:i+1, pageSize:1}, period, now));
      assert.deepEqual(result.map(page => page.total), Array(ids.length).fill(count));
      assert.deepEqual(result.map(page => page.items[0].id), ids);
    }
  } finally {
    await db.query('rollback');
    await db.end();
  }
});
