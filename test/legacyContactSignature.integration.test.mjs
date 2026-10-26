import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';

const adminUrl = process.env.LEGACY_CONTACT_TEST_ADMIN_URL;
test('contact backfill preserves real signatures, ACKed events, locks and retries', { skip: !adminUrl, timeout: 120000 }, async () => {
  const url = new URL(adminUrl);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  const name = `codex_contact_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  let client;
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
    url.pathname = `/${name}`;
    client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    const migrationName = '202610260004_runfeng_contact_signature.sql';
    for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql') && f < migrationName && f !== '202608070005_remove_obsolete_runfeng_sync_role.sql').sort()) {
      await client.query(await fs.readFile(`supabase/migrations/${file}`, 'utf8'));
    }
    const cases = [
      { status: 'pending', contact: '  李四  ', signatures: {}, expected: '李四' },
      { status: 'processing', contact: '\t\n', signatures: { advisor: '顾问' }, expected: '联系人' },
      { status: 'failed', contact: '王五', signatures: { customer: '真实签字人' }, expected: '王五' },
      { status: 'pending', signatures: null, expected: '联系人' },
      { status: 'synced', contact: '李四', signatures: { customer: '历史签名' }, expected: '历史签名' },
      { status: 'pending', contact: '李四', signatures: { customer: '李四' }, expected: '李四' }
    ];
    for (const [i, entry] of cases.entries()) {
      const id = `contact-order-${i}`;
      await client.query(`insert into work_orders(id,status,advisor,technician,inspector,old_parts_handling)
        values($1,'已委托','顾问','待派工','待检验','环保处理')`, [id]);
      await client.query("insert into signatures(order_id,signer_type,signer_name) values($1,'customer','真实签字人')", [id]);
      await client.query(`insert into legacy_sync_outbox(event_id,order_id,revision,event_type,payload,status,
        attempt_count,locked_by,locked_at,last_error,legacy_reid,legacy_document_no,legacy_dispatch_no)
        values($1,$2,1,'created',$3,$4,15,'consumer',now(),'original error',100,200,'A123')`,
      [`event-${i}`, id, JSON.stringify({ order: { customer: { contact: entry.contact }, signatures: entry.signatures } }), entry.status]);
    }
    const before = (await client.query('select * from legacy_sync_outbox order by event_id')).rows;
    const realSignatures = (await client.query('select * from signatures order by id')).rows;
    const migration = await fs.readFile(`supabase/migrations/${migrationName}`, 'utf8');
    await client.query(migration);
    const after = (await client.query('select * from legacy_sync_outbox order by event_id')).rows;
    for (const [i, row] of after.entries()) {
      assert.equal(row.payload.order.signatures.customer, cases[i].expected);
      if (i === 4 || i === 5) assert.deepEqual(row, before[i]);
      else {
        const { payload, updated_at, ...metadata } = row;
        const { payload: oldPayload, updated_at: oldUpdatedAt, ...oldMetadata } = before[i];
        assert.deepEqual(metadata, oldMetadata);
        assert.deepEqual(payload.order.customer, oldPayload.order.customer);
      }
    }
    assert.equal(after[1].payload.order.signatures.advisor, '顾问');
    assert.deepEqual((await client.query('select * from signatures order by id')).rows, realSignatures);
    const audits = (await client.query("select action from audit_logs where actor='系统迁移：202610260004' order by order_id")).rows;
    assert.equal(audits.length, 4);
    assert.ok(audits[2].action.includes('真实签字人'));
    await client.query(migration);
    assert.deepEqual((await client.query('select * from legacy_sync_outbox order by event_id')).rows, after);
    assert.equal((await client.query("select count(*) from audit_logs where actor='系统迁移：202610260004'")).rows[0].count, '4');
  } finally {
    await client?.end();
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.end();
  }
});
