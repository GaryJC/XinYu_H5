import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const adminUrl = process.env.SUPPRESSION_TEST_ADMIN_URL;
const targetedMigration = '202611110005_targeted_notifications.sql';
const dueMigration = '202611110004_suppressed_due_reminders.sql';
const suppressionMigration = '202611110002_suppressed_notification_kinds.sql';

test('notification suppression upgrades queued work without rewriting delivery history or paper read grants', { skip: !adminUrl, timeout: 120000 }, async t => {
  const url = new URL(adminUrl);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  const admin = new pg.Client({ connectionString: adminUrl });
  const name = `notification_suppression_${randomUUID().replaceAll('-', '')}`;
  let database;
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
    url.pathname = `/${name}`;
    Object.assign(process.env, { DATABASE_URL: url.toString(), APP_ENV: 'test', DISPATCH_NOTIFICATION_MODE: 'mock' });
    database = new pg.Client({ connectionString: url.toString() });
    await database.connect();
    for (const file of (await readdir('supabase/migrations')).filter(file => file.endsWith('.sql') && !['202608070005_remove_obsolete_runfeng_sync_role.sql', suppressionMigration, dueMigration, targetedMigration].includes(file)).sort()) {
      await database.query(await readFile(`supabase/migrations/${file}`, 'utf8'));
    }
    const statuses = ['pending', 'accepted', 'unknown', 'sent', 'failed'];
    for (const status of statuses) await database.query("insert into users(id,name,role,roles,shop_id) values($1,$1,'advisor',array['advisor'],'shop-hq')", [`suppression-${status}`]);
    const orderId = 'suppression-order';
    await database.query("insert into work_orders(id,status,advisor,technician,inspector,shop_id,old_parts_handling,paper_order) values($1,'维修中','顾问','维修工','检验员','shop-hq','客户带走','{\"mode\":\"pending\",\"photoIds\":[\"historical-photo\"]}')", [orderId]);
    await database.query("insert into dispatch_tasks(order_id,shop_id,stage) values($1,'shop-hq','维修中')", [orderId]);
    const dispatchRows = [];
    for (const kind of ['纸质委托书已创建', '维修暂停', '即将到期', '检验项目待定', '人工催办']) {
      for (const status of statuses) {
        const id = randomUUID();
        await database.query(`insert into dispatch_notifications(id,order_id,recipient_id,kind,payload,status,error,retryable,attempts,polls,task_id,
          delivery_user_id,delivery_submitted_at,result_queried_at,next_attempt_at,locked_until,lease_id)
          values($1,$2,$3,$4,'{}',$5,'retained historical detail',true,2,1,$6,$7,$8,$8,now()-interval '1 minute',now()+interval '1 hour',$9)`,
        [id, orderId, `suppression-${status}`, kind, status, status === 'pending' ? null : `task-${id}`, status === 'pending' ? null : 'original-dingtalk-account', status === 'pending' ? null : '2026-11-11T01:00:00Z', randomUUID()]);
        dispatchRows.push({ id, kind, status });
      }
    }
    const schedulerRows = [];
    for (const kind of ['维修暂停', '无法接单']) {
      for (const status of ['pending', 'failed', 'ready']) {
        const event = (await database.query(`insert into dispatch_events(order_id,actor_id,actor_name,request_id,request_body,action,detail)
          values($1,'suppression-pending','测试员工',$2,'{}',$3,'{}') returning id`, [orderId, randomUUID(), kind === '维修暂停' ? 'pause' : 'decline'])).rows[0];
        await database.query(`insert into dispatch_scheduler_notifications(event_id,order_id,kind,payload,status,error,attempts,next_attempt_at,locked_until,lease_id)
          values($1,$2,$3,'{}',$4,'historical resolution detail',3,now()-interval '1 minute',now()+interval '1 hour',$5)`, [event.id, orderId, kind, status, randomUUID()]);
        schedulerRows.push({ id: event.id, kind, status });
      }
    }
    const exceptions = [];
    for (const status of ['pending', 'failed', 'queued']) {
      const id = randomUUID();
      await database.query(`insert into vehicle_license_exceptions(id,order_id,request_id,vehicle_plate,vehicle_vin,reason,reported_by,reported_name,payload,status,error,attempts,locked_until,lease_id)
        values($1,$2,$3,'鲁BTEST','12345678901234567','客户未携带行驶证','suppression-pending','备案人','{}',$4,'historical resolution detail',2,now()+interval '1 hour',$5)`, [id, orderId, randomUUID(), status, randomUUID()]);
      exceptions.push({ id, status });
    }
    const licenseRows = [];
    for (const status of statuses) {
      const id = randomUUID();
      await database.query(`insert into vehicle_license_exception_notifications(id,exception_id,recipient_id,status,error,retryable,attempts,polls,task_id,
        delivery_user_id,delivery_submitted_at,result_queried_at,next_attempt_at,locked_until,lease_id)
        values($1,$2,$3,$4,'historical delivery detail',true,2,1,$5,$6,$7,$7,now()-interval '1 minute',now()+interval '1 hour',$8)`,
      [id, exceptions.find(row => row.status === 'queued').id, `suppression-${status}`, status, status === 'pending' ? null : `license-task-${id}`, status === 'pending' ? null : 'original-license-account', status === 'pending' ? null : '2026-11-11T02:00:00Z', randomUUID()]);
      licenseRows.push({ id, status });
    }
    const tables = ['dispatch_notifications', 'dispatch_scheduler_notifications', 'vehicle_license_exceptions', 'vehicle_license_exception_notifications'];
    const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async table => [table, (await database.query(`select * from ${table}`)).rows])));
    const before = await snapshot();
    await database.query(await readFile(`supabase/migrations/${suppressionMigration}`, 'utf8'));
    await database.query(await readFile(`supabase/migrations/${dueMigration}`, 'utf8'));
    await database.query(await readFile(`supabase/migrations/${targetedMigration}`, 'utf8'));
    const after = await snapshot();
    const find = (rows, id, key = 'id') => rows.find(row => row[key] === id);
    const assertSuppressed = row => {
      assert.equal(row.status, 'suppressed'); assert.equal(row.error, '');
      assert.equal(row.next_attempt_at, null); assert.equal(row.locked_until, null); assert.equal(row.lease_id, null);
      if ('retryable' in row) assert.equal(row.retryable, false);
    };
    await t.test('only pending disabled deliveries are suppressed; paper grants and actual delivery history remain intact', async () => {
      assert.equal(after.dispatch_notifications.length, before.dispatch_notifications.length);
      for (const row of dispatchRows) {
        const current = find(after.dispatch_notifications, row.id);
        const prior = find(before.dispatch_notifications, row.id);
        if (row.status === 'pending' && row.kind !== '人工催办') {
          assertSuppressed(current);
          for (const key of ['id', 'order_id', 'recipient_id', 'kind', 'payload', 'created_at', 'attempts', 'polls']) assert.deepEqual(current[key], prior[key]);
        } else assert.deepEqual(current, prior, `${row.kind}/${row.status}: stored result and snapshot remain unchanged`);
      }
      const grants = (await database.query("select recipient_id from dispatch_notifications where order_id=$1 and kind='纸质委托书已创建' order by recipient_id", [orderId])).rows.map(row => row.recipient_id);
      assert.deepEqual(grants, statuses.map(status => `suppression-${status}`).sort());
    });
    await t.test('pending and failed pause resolution jobs stop; other notices and completed jobs are unchanged', async () => {
      assert.equal(after.dispatch_scheduler_notifications.length, before.dispatch_scheduler_notifications.length);
      for (const row of schedulerRows) {
        const current = find(after.dispatch_scheduler_notifications, row.id, 'event_id');
        if (row.kind === '维修暂停' && row.status !== 'ready') assertSuppressed(current);
        else assert.deepEqual(current, find(before.dispatch_scheduler_notifications, row.id, 'event_id'));
      }
    });
    await t.test('license records survive, unsent deliveries stop and new records default to suppressed', async () => {
      assert.equal(after.vehicle_license_exceptions.length, before.vehicle_license_exceptions.length);
      assert.equal(after.vehicle_license_exception_notifications.length, before.vehicle_license_exception_notifications.length);
      for (const row of exceptions) {
        const current = find(after.vehicle_license_exceptions, row.id);
        const prior = find(before.vehicle_license_exceptions, row.id);
        if (row.status === 'queued') assert.deepEqual(current, prior);
        else {
          assertSuppressed(current);
          for (const key of ['reason', 'vehicle_plate', 'vehicle_vin', 'reported_by', 'reported_name', 'reported_at', 'payload']) assert.deepEqual(current[key], prior[key]);
        }
      }
      for (const row of licenseRows) {
        const current = find(after.vehicle_license_exception_notifications, row.id);
        if (row.status === 'pending') assertSuppressed(current);
        else assert.deepEqual(current, find(before.vehicle_license_exception_notifications, row.id));
      }
      const created = (await database.query(`insert into vehicle_license_exceptions(id,order_id,request_id,vehicle_plate,vehicle_vin,reason,reported_by,reported_name,payload)
        values($1,$2,$3,'鲁BDEFAULT','12345678901234567','没有行驶证','suppression-pending','备案人','{}') returning status`, [randomUUID(), orderId, randomUUID()])).rows[0];
      assert.equal(created.status, 'suppressed');
    });
    await t.test('pending rows from an older writer are suppressed before reading recipients or calling OpenAPI', async () => {
      const { claimNotification, finishNotification } = await import('../server/repositories/dispatchNotificationRepository.mjs');
      const { processNotification } = await import('../server/workers/dispatchNotifications.mjs');
      for (const kind of ['纸质委托书已创建', '维修暂停', '即将到期', '检验项目待定']) {
        const id = randomUUID(), recipientId = `late-${id}`;
        await database.query("insert into users(id,name,role,shop_id) values($1,'旧进程收件人','manager','other-shop')", [recipientId]);
        await database.query("insert into dispatch_notifications(id,order_id,recipient_id,kind,payload) values($1,$2,$3,$4,'{}')", [id, orderId, recipientId, kind]);
        let reads = 0, sends = 0;
        assert.equal(await processNotification({
          claim: () => claimNotification(database), finish: (row, result) => finishNotification(row, result, database),
          recipient: async () => { reads++; throw new Error('recipient lookup must not occur'); },
          send: async () => { sends++; throw new Error('OpenAPI must not occur'); }
        }), true);
        const saved = (await database.query('select * from dispatch_notifications where id=$1', [id])).rows[0];
        assertSuppressed(saved); assert.equal(saved.task_id, null); assert.equal(saved.delivery_user_id, null);
        assert.equal(reads, 0); assert.equal(sends, 0); assert.equal(saved.attempts, 1);
      }
      assert.equal(await claimNotification(database), undefined, 'suppressed rows never re-enter the pending queue');
    });
  } finally {
    if (database) await database.end();
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.end();
  }
});
