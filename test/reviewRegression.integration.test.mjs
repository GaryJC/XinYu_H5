import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';

const adminUrl = process.env.REVIEW_TEST_ADMIN_URL;

test('review regressions: employee opening, scoped capabilities and immutable signing evidence', { skip: !adminUrl, timeout: 120000 }, async t => {
  const url = new URL(adminUrl);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  const admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
  await admin.connect();
  const name = `review_regression_${process.pid}_${Date.now()}`;
  const uploads = await fs.mkdtemp(path.join(os.tmpdir(), 'review-uploads-'));
  let pool;
  try {
    await admin.query(`create database "${name}"`);
    url.pathname = `/${name}`;
    Object.assign(process.env, {
      DATABASE_URL: url.toString(), APP_ENV: 'test', JWT_SECRET: 'isolated-review-test-secret',
      FILE_STORAGE_PROVIDER: 'local', LOCAL_UPLOAD_ROOT: uploads, RUNFENG_REPAIR_WRITEBACK_ENABLED: 'false'
    });
    ({ pool } = await import('../server/database/pool.mjs'));
    for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql') && f !== '202608070005_remove_obsolete_runfeng_sync_role.sql').sort()) {
      await pool.query(await fs.readFile(`supabase/migrations/${file}`, 'utf8'));
    }
    const db = await import('../server/db.mjs');
    const { handleApiRequest } = await import('../server/routes/apiRouter.mjs');
    const { createTokenForUser } = await import('../server/auth.mjs');
    const { createAuthSession } = await import('../server/repositories/userRepository.mjs');
    const { saveUploadedFile } = await import('../server/storage.mjs');
    const users = ['employee', 'technician', 'inspector', 'warehouse', 'outsourcing', 'advisor', 'manager'].map(role => ({
      id: `review-${role}`, name: `review ${role}`, role, roles: [role], active: true, shopId: 'review-shop'
    }));
    const orders = new Map();
    for (const user of users) {
      await pool.query('insert into users(id,name,role,roles,shop_id) values($1,$2,$3,$4,$5)', [user.id, user.name, user.role, user.roles, user.shopId]);
      orders.set(user.role, await db.createWorkOrder({ shop: { id: user.shopId }, advisor: user.name }, user.name, user));
    }
    const foreign = await db.createWorkOrder({ shop: { id: 'foreign-shop' }, advisor: users[1].name }, 'test');
    const taskOrder = await db.createWorkOrder({ shop: { id: 'review-shop' }, advisor: 'someone else' }, 'test');
    await pool.query("insert into dispatch_tasks(order_id,shop_id,technician_id,inspector_id,stage,data) values($1,'review-shop',$2,$3,'维修中',$4)",
      [taskOrder.id, users[1].id, users[2].id, JSON.stringify({ technicianIds: [users[1].id] })]);

    await t.test('every employee can reload their own draft while assignment and shop restrictions hold', async () => {
      for (const user of users.slice(0, 5)) {
        const expected = [orders.get(user.role).id, ...(['technician', 'inspector'].includes(user.role) ? [taskOrder.id] : [])].sort();
        assert.deepEqual((await db.listWorkOrders(user.role, user)).map(o => o.id).sort(), expected);
        assert.deepEqual((await db.listWorkOrders(user.role, user, { page: '1', pageSize: '50' })).items.map(o => o.id).sort(), expected);
      }
      const dual = { ...users[1], roles: ['technician', 'inspector'] };
      assert.ok((await db.listWorkOrders(dual.role, dual)).some(o => o.id === orders.get('technician').id));
      assert.ok(!(await db.listWorkOrders(dual.role, dual)).some(o => o.id === foreign.id));
    });

    await t.test('real content and thumbnail routes work before technician binding and reject other employees', async () => {
      const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#334455' } }).png().toBuffer();
      for (const user of users.slice(0, 5)) {
        const token = createTokenForUser(user.id);
        await createAuthSession({ token, userId: user.id, expiresAt: new Date(Date.now() + 60000) });
        const file = await saveUploadedFile({ kind: 'vehicle_license', mimeType: 'image/png', imageBase64: image.toString('base64'), uploadedBy: user.id });
        for (const suffix of ['', '?size=thumbnail']) {
          let body;
          const res = { setHeader() {}, end(value) { body = value; } };
          await handleApiRequest({ method: 'GET', headers: { authorization: `Bearer ${token}` } }, res, new URL(`http://local/api/files/${file.id}/content${suffix}`));
          assert.equal(res.statusCode, 200);
          assert.ok(Buffer.isBuffer(body) && body.length > 0);
        }
        await pool.query('update files set uploaded_by=$2 where id=$1', [file.id, users[6].id]);
        await assert.rejects(() => handleApiRequest({ method: 'GET', headers: { authorization: `Bearer ${token}` } }, { setHeader() {}, end() {} }, new URL(`http://local/api/files/${file.id}/content`)), e => e.status === 403);
      }
    });

    await t.test('cross-shop paper notifications grant visibility without exposing signature sessions', async () => {
      const manager = users[6];
      const local = orders.get('advisor');
      await pool.query('update work_orders set paper_order=$2::jsonb where id=$1', [foreign.id, JSON.stringify({ mode: 'dingtalk', photoIds: ['paper-fixture'] })]);
      await pool.query("insert into dispatch_notifications(id,order_id,recipient_id,kind,payload) values($1,$2,$3,'纸质委托书已创建','{}')", [randomUUID(), foreign.id, manager.id]);
      await pool.query("insert into signature_tokens(token,order_id) values('foreign-secret',$1),('local-secret',$2)", [foreign.id, local.id]);
      for (const query of [{}, { page: '1', pageSize: '50' }]) {
        const result = await db.listWorkOrders(manager.role, manager, query);
        const orders = Array.isArray(result) ? result : result.items;
        assert.ok(orders.some(order => order.id === foreign.id));
        assert.equal(orders.find(order => order.id === foreign.id).signatureToken, undefined);
        assert.equal(orders.find(order => order.id === local.id).signatureToken, 'local-secret');
      }
    });

    await t.test('saving an unchanged signature preserves its timestamp and file evidence', async () => {
      const order = orders.get('manager');
      const signedAt = new Date('2026-01-02T03:04:05.000Z');
      await pool.query("insert into files(id,order_id,kind,storage_provider,bucket,object_key) values('signature-evidence',$1,'signature_image','local','local','fixture')", [order.id]);
      await pool.query("insert into signatures(order_id,signer_type,signer_name,signed_at,file_id) values($1,'customer','客户',$2,'signature-evidence')", [order.id, signedAt]);
      const saved = await db.findWorkOrderById(pool, order.id);
      await db.upsertWorkOrder(pool, { ...saved, feeNote: 'unrelated change' });
      const { rows: [signature] } = await pool.query("select signed_at,file_id from signatures where order_id=$1 and signer_type='customer'", [order.id]);
      assert.equal(signature.signed_at.toISOString(), signedAt.toISOString());
      assert.equal(signature.file_id, 'signature-evidence');
    });
  } finally {
    if (pool) await pool.end();
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.end();
    await fs.rm(uploads, { recursive: true, force: true });
  }
});
