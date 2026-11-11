import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Readable } from 'node:stream';

const adminUrl = process.env.NOTIFICATION_QUERY_TEST_ADMIN_URL;
test('manual notification results are authorized, one-shot, and durable across all delivery sources', { skip: !adminUrl }, async t => {
  const url = new URL(adminUrl);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const name = `notification_query_${process.pid}_${Date.now()}`;
  let pool;
  try {
    await admin.query(`create database "${name}"`);
    url.pathname = `/${name}`;
    process.env.DATABASE_URL = url.toString(); process.env.APP_ENV = 'test'; process.env.DISPATCH_NOTIFICATION_MODE = 'mock';
    ({ pool } = await import('../server/database/pool.mjs'));
    for (const file of (await fs.readdir('supabase/migrations')).filter(file => file.endsWith('.sql') && file !== '202608070005_remove_obsolete_runfeng_sync_role.sql').sort()) await pool.query(await fs.readFile(`supabase/migrations/${file}`, 'utf8'));
    const service = await import('../server/services/notificationQueryService.mjs');
    const repository = await import('../server/repositories/notificationQueryRepository.mjs');
    const { handleNotifications } = await import('../server/routes/notificationRouter.mjs');
    const actors = Object.fromEntries(['manager', 'advisor', 'warehouse', 'employee', 'otherEmployee', 'outside'].map(role => [role, {
      id: `query-${role}`, role: ['otherEmployee', 'outside'].includes(role) ? 'employee' : role, active: true, shopId: role === 'outside' ? 'elsewhere' : 'shop-hq'
    }]));
    for (const actor of Object.values(actors)) await pool.query('insert into users(id,name,role,roles,active,shop_id) values($1,$2,$3,array[$3]::text[],true,$4)', [actor.id, actor.id, actor.role, actor.shopId]);
    const orderId = 'query-order', tripId = 'query-trip', carId = 'query-car';
    const tenderId = randomUUID(), supplierId = randomUUID(), reportId = randomUUID(), exceptionId = randomUUID();
    await pool.query("insert into work_orders(id,status,advisor,technician,inspector,shop_id,old_parts_handling) values($1,'维修中','顾问','维修工','检验员','shop-hq','客户带走')", [orderId]);
    await pool.query("insert into company_vehicles(id,shop_id,plate,brand,model) values($1,'shop-hq','鲁BQUERY','测试','测试')", [carId]);
    await pool.query("insert into vehicle_trip_requests(id,shop_id,applicant_id,applicant_name,vehicle_id,vehicle_snapshot,reason) values($1,'shop-hq',$2,'申请人',$3,'{}','测试')", [tripId, actors.employee.id, carId]);
    await pool.query("insert into vehicle_trip_operations(actor_id,request_id,fingerprint,trip_id,action,actor_name,result) values($1,'query-request','test',$2,'return','申请人','{}')", [actors.employee.id, tripId]);
    await pool.query("insert into vehicle_trip_notification_jobs(id,trip_id,actor_id,request_id,action,payload) values('query-job',$1,$2,'query-request','return','{}')", [tripId, actors.employee.id]);
    await pool.query("insert into procurement_tenders(id,shop_id,created_by,request_id,request_body,data) values($1,'shop-hq',$2,$3,'{}','{}')", [tenderId, actors.warehouse.id, randomUUID()]);
    await pool.query("insert into procurement_suppliers(id,shop_id,name,contact_name,phone) values($1,'shop-hq','测试供应商','测试','13800000000')", [supplierId]);
    await pool.query("insert into procurement_reports(id,shop_id,supplier_id,snapshot,created_by) values($1,'shop-hq',$2,'{}',$3)", [reportId, supplierId, actors.warehouse.id]);
    await pool.query("insert into vehicle_license_exceptions(id,order_id,request_id,vehicle_plate,vehicle_vin,reason,reported_by,reported_name,payload) values($1,$2,'query-license','鲁BQUERY','','测试缺失',$3,'顾问','{}')", [exceptionId, orderId, actors.advisor.id]);
    const specs = {
      dispatch: { table: 'dispatch_notifications', resourceId: orderId, insert: "insert into dispatch_notifications(id,order_id,recipient_id,kind,payload) values($1,$2,$3,'待检验','{}')", params: [orderId] },
      procurement: { table: 'procurement_notifications', resourceId: tenderId, insert: "insert into procurement_notifications(id,tender_id,recipient_id,shop_id,payload) values($1,$2,$3,'shop-hq','{\"title\":\"竞价通知\"}')", params: [tenderId] },
      'vehicle-trip': { table: 'vehicle_trip_notifications', resourceId: tripId, insert: 'insert into vehicle_trip_notifications(id,job_id,recipient_id) values($1,$2,$3)', params: ['query-job'] },
      'license-exception': { table: 'vehicle_license_exception_notifications', resourceId: exceptionId, insert: 'insert into vehicle_license_exception_notifications(id,exception_id,recipient_id) values($1,$2,$3)', params: [exceptionId] },
      'vehicle-insurance': { table: 'vehicle_insurance_notifications', resourceId: carId, insert: "insert into vehicle_insurance_notifications(id,vehicle_id,recipient_id,insurance_end,milestone) values($1,$2,$3,current_date,0)", params: [carId] }
    };
    const createNotice = async (source, recipient = actors.manager.id) => {
      const spec = specs[source], id = randomUUID();
      await pool.query(spec.insert, [id, ...spec.params, recipient]);
      await pool.query(`update ${spec.table} set status='accepted',attempts=1,task_id=$2,delivery_user_id='original-ding-account',delivery_submitted_at=now()-interval '1 minute',next_attempt_at=null where id=$1`, [id, `mock-${id}`]);
      return id;
    };
    const get = async (source, id) => (await pool.query(`select * from ${specs[source].table} where id=$1`, [id])).rows[0];
    const noRemote = async () => { throw new Error('Unexpected OpenAPI request'); };
    const ids = {};
    await t.test('all five source lists project only public fields and enforce resource access', async () => {
      for (const source of Object.keys(specs)) {
        const id = ids[source] = await createNotice(source);
        const rows = await service.listNotificationDeliveries(actors.manager, source, specs[source].resourceId);
        const row = rows.find(row => row.id === id);
        assert.ok(row?.canQuery); assert.equal(row.attempts, 1); assert.equal(row.status, 'accepted');
        for (const key of ['task_id', 'taskId', 'delivery_user_id', 'recipient_id', 'payload', 'lease_id']) assert.equal(row[key], undefined);
        await assert.rejects(() => service.listNotificationDeliveries(actors.outside, source, specs[source].resourceId), error => error.status === 404);
        await assert.rejects(() => service.queryNotificationDelivery(actors.outside, source, id, { query: noRemote }), error => error.status === 404);
      }
      await service.listNotificationDeliveries(actors.employee, 'vehicle-trip', tripId);
      await assert.rejects(() => service.listNotificationDeliveries(actors.otherEmployee, 'vehicle-trip', tripId), error => error.status === 403);
      await service.listNotificationDeliveries(actors.warehouse, 'procurement', tenderId);
      await assert.rejects(() => service.listNotificationDeliveries(actors.advisor, 'procurement', tenderId), error => error.status === 403);
      await assert.rejects(() => service.listNotificationDeliveries(actors.employee, 'dispatch', orderId), error => error.status === 403);
      assert.deepEqual(await service.listNotificationDeliveries(actors.warehouse, 'procurement', reportId), []);
    });
    await t.test('single manual queries use sent account snapshots and never schedule follow-up checks', async () => {
      await pool.query("update users set dingtalk_user_id='changed-account' where id=$1", [actors.manager.id]);
      for (const source of Object.keys(specs)) {
        let calls = 0;
        const output = await service.queryNotificationDelivery(actors.manager, source, ids[source], { query: async (row, target) => {
          calls++; assert.equal(target, 'original-ding-account'); assert.ok(row.task_id); return { status: 'accepted', error: '等待平台结果' };
        } });
        assert.equal(calls, 1); assert.equal(output.status, 'accepted');
        const row = await get(source, ids[source]);
        assert.equal(row.status, 'accepted'); assert.equal(row.next_attempt_at, null); assert.equal(row.lease_id, null); assert.equal(row.polls, 1);
        await assert.rejects(() => service.queryNotificationDelivery(actors.manager, source, ids[source], { query: noRemote }), error => error.status === 409);
      }
    });
    await t.test('procurement keeps pending and failed recipient resolution jobs visible without making them queryable', async () => {
      const jobs = ['pending', 'failed', 'ready'].map(status => ({ id: randomUUID(), status }));
      for (const job of jobs) await pool.query("insert into procurement_notification_jobs(id,shop_id,tender_id,payload,status,error) values($1,'shop-hq',$2,$3,$4,$5)", [job.id, tenderId, JSON.stringify({ title: 'not exposed payload', summary: 'private notification body' }), job.status, job.status === 'failed' ? '岗位名单读取失败' : '']);
      const listed = await service.listNotificationDeliveries(actors.warehouse, 'procurement', tenderId);
      for (const job of jobs) {
        const row = listed.find(row => row.id === `job:${job.id}`);
        if (job.status === 'ready') { assert.equal(row, undefined); continue; }
        assert.equal(row.status, job.status); assert.equal(row.canQuery, false); assert.equal(row.kind, '通知接收人同步');
        assert.equal(row.queryUnavailableReason, undefined); assert.equal(row.payload, undefined);
        if (job.status === 'failed') assert.equal(row.error, '岗位名单读取失败');
        await assert.rejects(() => service.queryNotificationDelivery(actors.warehouse, 'procurement', row.id, { query: noRemote }), error => error.status === 400);
      }
      assert.ok(listed.some(row => row.id === ids.procurement));
      assert.deepEqual(await service.listNotificationDeliveries(actors.manager, 'procurement', reportId), []);
      await assert.rejects(() => service.listNotificationDeliveries(actors.outside, 'procurement', tenderId), error => error.status === 404);
    });
    await t.test('parallel clicks share a database claim and cause exactly one remote query', async () => {
      const id = await createNotice('dispatch'); let calls = 0, release, entered;
      const started = new Promise(resolve => { entered = resolve; });
      const response = new Promise(resolve => { release = resolve; });
      const query = async () => { calls++; entered(); await response; return { status: 'sent' }; };
      const first = service.queryNotificationDelivery(actors.manager, 'dispatch', id, { query });
      await started;
      await assert.rejects(() => service.queryNotificationDelivery(actors.advisor, 'dispatch', id, { query }), error => error.status === 409);
      release(); assert.deepEqual(await first, { status: 'sent', error: '' }); assert.equal(calls, 1);
      await assert.rejects(() => service.queryNotificationDelivery(actors.manager, 'dispatch', id, { query: noRemote }), error => error.status === 409);
    });
    await t.test('missing snapshots, task IDs, and expired tasks make no OpenAPI requests', async () => {
      for (const sql of ["delivery_user_id=null", "delivery_submitted_at=null", "task_id=null", "delivery_submitted_at=now()-interval '24 hours'", "status='failed'", "status='pending'"]) {
        const id = await createNotice('dispatch'); await pool.query(`update dispatch_notifications set ${sql} where id=$1`, [id]);
        await assert.rejects(() => service.queryNotificationDelivery(actors.manager, 'dispatch', id, { query: noRemote }), error => error.status === 409);
        const item = (await service.listNotificationDeliveries(actors.manager, 'dispatch', orderId)).find(row => row.id === id);
        assert.equal(item.canQuery, false);
      }
    });
    await t.test('failed, unknown, malformed, and transport exceptions never cause resending or automatic polling', async () => {
      for (const status of ['failed', 'unknown', 'malformed', 'throw']) {
        const id = await createNotice('dispatch');
        const output = await service.queryNotificationDelivery(actors.manager, 'dispatch', id, { query: async () => {
          if (status === 'throw') throw new Error('remote failure');
          return { status, error: '模拟结果', retryable: true };
        } });
        assert.equal(output.status, ['failed', 'unknown'].includes(status) ? status : 'unknown');
        const row = await get('dispatch', id);
        assert.equal(row.retryable, false); assert.equal(row.next_attempt_at, null); assert.equal(row.lease_id, null); assert.equal(row.attempts, 1);
      }
    });
    await t.test('current roles and activation are checked rather than trusting stale request actors', async () => {
      const id = await createNotice('dispatch');
      await pool.query("update users set role='employee',roles=array['employee'] where id=$1", [actors.advisor.id]);
      await assert.rejects(() => service.queryNotificationDelivery(actors.advisor, 'dispatch', id, { query: noRemote }), error => error.status === 403);
      await pool.query("update users set role='advisor',roles=array['advisor'],active=false where id=$1", [actors.advisor.id]);
      await assert.rejects(() => service.queryNotificationDelivery(actors.advisor, 'dispatch', id, { query: noRemote }), error => error.status === 403);
      await pool.query('update users set active=true where id=$1', [actors.advisor.id]);
      await pool.query("update users set roles=array['advisor','technician'] where id=$1", [actors.advisor.id]);
      await assert.rejects(() => service.listNotificationDeliveries(actors.advisor, 'dispatch', orderId), /匹配润丰员工编码/);
      await assert.rejects(() => service.queryNotificationDelivery(actors.advisor, 'license-exception', ids['license-exception'], { query: noRemote }), /匹配润丰员工编码/);
      await pool.query("update users set roles=array['advisor'] where id=$1", [actors.advisor.id]);
    });
    await t.test('revocation during a remote request prevents returning its result', async () => {
      const id = await createNotice('dispatch');
      await assert.rejects(() => service.queryNotificationDelivery(actors.advisor, 'dispatch', id, { query: async () => {
        await pool.query('update users set active=false where id=$1', [actors.advisor.id]); return { status: 'sent' };
      } }), error => error.status === 403);
      assert.equal((await get('dispatch', id)).lease_id, null);
      await pool.query('update users set active=true where id=$1', [actors.advisor.id]);
    });
    await t.test('revocation after claiming prevents the remote query and cleanup failure preserves the authorization error', async () => {
      const id = await createNotice('dispatch'); let queries = 0;
      const database = { query: async (sql, values) => {
        if (sql.startsWith('update dispatch_notifications set lease_id=null')) throw Object.assign(new Error('temporary database failure'), { code: 'TEST_CLEANUP_FAILURE' });
        const result = await pool.query(sql, values);
        if (sql.startsWith('update dispatch_notifications set lease_id=$2')) await pool.query('update users set active=false where id=$1', [actors.advisor.id]);
        return result;
      } };
      try {
        await assert.rejects(() => service.queryNotificationDelivery(actors.advisor, 'dispatch', id, { database, query: async () => { queries++; return { status: 'sent' }; } }), error => error.status === 403);
        assert.equal(queries, 0); assert.equal((await get('dispatch', id)).status, 'accepted');
      } finally {
        await pool.query('update users set active=true where id=$1', [actors.advisor.id]);
        await pool.query('update dispatch_notifications set lease_id=null,locked_until=null where id=$1', [id]);
      }
    });
    await t.test('stale leases cannot overwrite or unlock a later owner', async () => {
      const id = await createNotice('dispatch'), newerLease = randomUUID();
      await assert.rejects(() => service.queryNotificationDelivery(actors.manager, 'dispatch', id, { query: async () => {
        await pool.query("update dispatch_notifications set lease_id=$2,status='unknown' where id=$1", [id, newerLease]);
        return { status: 'sent' };
      } }), error => error.status === 409);
      const row = await get('dispatch', id); assert.equal(row.lease_id, newerLease); assert.equal(row.status, 'unknown');
      assert.equal(await repository.saveNotificationQuery('dispatch', { ...row, lease_id: randomUUID() }, { status: 'sent' }, pool), false);
    });
    await t.test('HTTP routes require authentication and the query POST ignores client task/target overrides', async () => {
      const { handleApiRequest } = await import('../server/routes/apiRouter.mjs');
      await assert.rejects(() => handleApiRequest({ method: 'GET', headers: {} }, {}, new URL('http://localhost/api/notifications?source=dispatch&resourceId=query-order')), error => error.status === 401);
      const id = await createNotice('dispatch'), output = {};
      const response = { setHeader() {}, end(value) { output.body = JSON.parse(value); }, set statusCode(value) { output.status = value; } };
      const req = Readable.from([Buffer.from(JSON.stringify({ task_id: 'attacker-task', recipient: 'attacker-account', source: 'procurement' }))]);
      req.method = 'POST';
      assert.equal(await handleNotifications(req, response, new URL(`http://localhost/api/notifications/dispatch/${id}/query`), actors.manager), true);
      assert.equal(output.status, 200); assert.deepEqual(output.body, { status: 'sent', error: '' });
      const row = await get('dispatch', id);
      assert.equal(row.task_id, `mock-${id}`); assert.equal(row.delivery_user_id, 'original-ding-account'); assert.equal(row.polls, 1);
      await assert.rejects(() => handleNotifications({ method: 'GET' }, response, new URL(`http://localhost/api/notifications/dispatch/${id}/query`), actors.manager), error => error.status === 405);
    });
  } finally {
    if (pool) await pool.end();
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.end();
  }
});
