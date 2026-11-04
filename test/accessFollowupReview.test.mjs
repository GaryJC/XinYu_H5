import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// Explicitly selected local server only; existing business databases are never used.
const adminUrl = process.env.ACCESS_REVIEW_TEST_ADMIN_URL;
test('customer signature input preserves signature and session atomicity', { skip: !adminUrl, timeout: 120000 }, async t => {
  const url = new URL(adminUrl);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  const name = `codex_access_review_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
  let pool;
  const connectionsClosed = [];
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
    url.pathname = `/${name}`;
    process.env.DATABASE_URL = url.toString();
    process.env.APP_ENV = 'test';
    process.env.RUNFENG_REPAIR_WRITEBACK_ENABLED = 'false';
    ({ pool } = await import('../server/database/pool.mjs'));
    pool.on('connect', client => connectionsClosed.push(new Promise(resolve => client.once('end', resolve))));
    for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql') && f !== '202608070005_remove_obsolete_runfeng_sync_role.sql').sort()) {
      await pool.query(await fs.readFile(`supabase/migrations/${file}`, 'utf8'));
    }
    const actor = { id: 'signature-review-manager', name: '签字测试管理员', role: 'manager', active: true, shopId: 'shop-hq' };
    await pool.query("insert into users(id,name,role,active,shop_id) values($1,$2,'manager',true,'shop-hq')", [actor.id, actor.name]);
    const db = await import('../server/db.mjs');
    async function seed(status = '草稿') {
      const id = `signature-${randomUUID()}`;
      const front = randomUUID(), rear = randomUUID(), fileId = randomUUID();
      await pool.query(`insert into work_orders(id,status,advisor,technician,inspector,old_parts_handling,vehicle_plate,vehicle_vin,vehicle_mileage,
        vehicle_model,vehicle_model_legacy_code,customer_name,customer_legacy_code,customer_phone,department_code,department_name,inspection)
        values($1,$2,$3,'待派工','待检验','客户带走','鲁BTEST','LSVAB1234A1234567','1000','测试车型','MODEL','测试客户','CUSTOMER','13800000000','01','维修部',$4)`,
      [id, status, actor.name, JSON.stringify({ preRepairPhotos: { front45: front, rear45: rear } })]);
      await pool.query("insert into repair_items(order_id,client_item_id,item_no,name) values($1,1,1,'检查')", [id]);
      for (const [file, kind] of [[front, 'repair_order_photo'], [rear, 'repair_order_photo'], [fileId, 'signature_image'], [randomUUID(), 'vehicle_license']]) {
        await pool.query("insert into files(id,order_id,kind,storage_provider,bucket,object_key,mime_type,size_bytes,uploaded_by) values($1,$2,$3,'local','','fixture','image/png',8,$4)", [file, id, kind, actor.id]);
      }
      const session = await db.createSignatureTokenForOrder(id, actor.name, { signatureMode: 'onsite' });
      return { id, fileId, token: session.signatureToken };
    }
    async function snapshot(id, token) {
      return {
        order: (await pool.query('select status,customer_signature_review from work_orders where id=$1', [id])).rows[0],
        signatures: (await pool.query('select signer_type,signer_name,file_id from signatures where order_id=$1 order by signer_type', [id])).rows,
        token: (await pool.query('select used,used_at from signature_tokens where token=$1', [token])).rows[0],
        syncs: (await pool.query('select count(*) from legacy_sync_outbox where order_id=$1', [id])).rows[0].count,
        notifications: (await pool.query('select count(*) from dispatch_notifications where order_id=$1', [id])).rows[0].count
      };
    }
    for (const [label, signature] of [['missing', undefined], ['null', null], ['empty', ''], ['whitespace', ' \t\n'], ['object', { name: '客户' }], ['array', ['客户']]]) {
      await t.test(`rejects ${label} signer without consuming the onsite session`, async () => {
        const { id, fileId, token } = await seed();
        const before = await snapshot(id, token);
        await assert.rejects(() => db.signWorkOrderByToken(token, signature, fileId, undefined, actor), error => error.status === 400);
        assert.deepEqual(await snapshot(id, token), before);
        const signed = await db.signWorkOrderByToken(token, '测试客户', fileId, undefined, actor);
        assert.equal(signed.status, '已委托');
        assert.equal(signed.customerSignatureFileId, fileId);
        assert.equal(signed.signatures.customer, '测试客户');
        assert.equal(signed.customerSignatureReview.state, 'confirmed');
      });
    }
    await t.test('invalid file identifiers do not consume the session or advance the order', async () => {
      const { id, token, fileId } = await seed();
      const before = await snapshot(id, token);
      for (const invalid of [undefined, null, '', ' \t', 123, { id: fileId }, [fileId]]) {
        await assert.rejects(() => db.signWorkOrderByToken(token, '测试客户', invalid, undefined, actor), error => error.status === 400);
        assert.deepEqual(await snapshot(id, token), before);
      }
      const signed = await db.signWorkOrderByToken(token, '测试客户', fileId, undefined, actor);
      assert.equal(signed.customerSignatureFileId, fileId);
    });
    await t.test('remote signatures derive the signer and remain pending staff review', async () => {
      const { id, fileId } = await seed();
      const session = await db.createSignatureTokenForOrder(id, actor.name, { signatureMode: 'remote' });
      const signed = await db.signWorkOrderByToken(session.signatureToken, null, null, async () => ({ id: fileId }));
      assert.equal(signed.customerSignatureFileId, fileId);
      assert.equal(signed.signatures.customer, '测试客户');
      assert.equal(signed.status, '待客户签字');
      assert.equal(signed.customerSignatureReview.state, 'pending');
    });
    await t.test('supplemental onsite signature preserves the existing repair status', async () => {
      const { id, token, fileId } = await seed('维修中');
      const before = await snapshot(id, token);
      await assert.rejects(() => db.signWorkOrderByToken(token, '', fileId, undefined, actor), error => error.status === 400);
      assert.deepEqual(await snapshot(id, token), before);
      const signed = await db.signWorkOrderByToken(token, '补签客户', fileId, undefined, actor);
      assert.equal(signed.status, '维修中');
      assert.equal(signed.customerSignatureFileId, fileId);
      assert.equal(signed.customerSignatureReview.state, 'confirmed');
    });
  } finally {
    if (pool) await pool.end();
    await Promise.all(connectionsClosed);
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.end();
  }
});
