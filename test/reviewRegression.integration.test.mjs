import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
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

    await t.test('assigned technicians and inspectors can open the same details as their archive without edit rights', async () => {
      const { assertWorkOrderAccess } = await import('../server/repositories/accessRepository.mjs');
      for (const user of [users[1], users[2]]) {
        assert.equal((await db.getWorkOrderDetail(taskOrder.id, user)).id, taskOrder.id);
        await assert.rejects(() => assertWorkOrderAccess(taskOrder.id, user), e => e.status === 403);
        await assert.rejects(() => db.getWorkOrderDetail(foreign.id, user), e => e.status === 403);
      }
      await assert.rejects(() => db.getWorkOrderDetail(taskOrder.id, { ...users[2], inspectorRoleMember: false }), e => e.status === 403);
    });

    await t.test('work-order uploads accept opening photos and reserve task photos for the repair workflow', async () => {
      const user = users[5];
      const token = createTokenForUser(user.id);
      await createAuthSession({ token, userId: user.id, expiresAt: new Date(Date.now() + 60000) });
      const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#334455' } }).png().toBuffer();
      const orderId = orders.get('advisor').id;
      async function upload(kind) {
        const body = { orderId, kind, mimeType: 'image/png', fileName: 'photo.png', imageBase64: image.toString('base64') };
        const req = Readable.from([Buffer.from(JSON.stringify(body))]);
        req.method = 'POST';
        req.headers = { authorization: `Bearer ${token}` };
        let record;
        await handleApiRequest(req, { setHeader() {}, end(value) { record = JSON.parse(value); } }, new URL('http://local/api/files'));
        return record;
      }
      assert.equal((await upload('vehicle_license')).uploadedBy, user.id);
      await assert.rejects(() => upload('vehicle_nameplate_photo'), e => e.status === 400);
      assert.equal((await pool.query("select 1 from files where order_id=$1 and kind='vehicle_nameplate_photo'", [orderId])).rowCount, 0);
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
      const detail = await db.getWorkOrderDetail(foreign.id, manager);
      assert.equal(detail.id, foreign.id);
      assert.equal(detail.signatureToken, undefined);
      await assert.rejects(() => db.getWorkOrderDetail(foreign.id, users[5]), e => e.status === 403);
      const { assertWorkOrderAccess } = await import('../server/repositories/accessRepository.mjs');
      await assert.rejects(() => assertWorkOrderAccess(foreign.id, manager), e => e.status === 403);
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

    await t.test('new order ownership survives employee renames and cannot be transferred by editing the draft', async () => {
      const owner = users[5];
      const namesake = { ...owner, id: 'namesake-advisor' };
      await pool.query('insert into users(id,name,role,shop_id) values($1,$2,$3,$4)', [namesake.id, namesake.name, namesake.role, namesake.shopId]);
      const order = await db.createWorkOrder({ advisor: owner.name, advisorUserId: namesake.id, shop: { id: owner.shopId } }, owner.name, owner);
      assert.equal(order.advisorUserId, owner.id);
      const { assertWorkOrderAccess } = await import('../server/repositories/accessRepository.mjs');
      await assert.rejects(() => assertWorkOrderAccess(order.id, namesake), e => e.status === 403);
      await assert.rejects(() => db.updateWorkOrder(order, namesake.name, '保存草稿', namesake), e => e.status === 403);
      await assert.rejects(() => db.deleteDraftWorkOrder(order.id, undefined, namesake), e => e.status === 403);
      const renamed = { ...owner, name: '新姓名' };
      const saved = await db.updateWorkOrder({ ...order, advisorUserId: namesake.id }, renamed.name, '保存草稿', renamed);
      assert.equal(saved.advisorUserId, owner.id);
      await pool.query("insert into signature_tokens(token,order_id) values('owner-only',$1)", [order.id]);
      assert.equal((await db.getWorkOrderDetail(order.id, namesake)).signatureToken, undefined);
      assert.equal((await db.getWorkOrderDetail(order.id, renamed)).signatureToken, 'owner-only');
      const file = await pool.query("insert into files(id,order_id,kind,storage_provider,bucket,object_key) values($1,$2,'vehicle_license','local','','fixture') returning id", [randomUUID(),order.id]);
      const { assertFileAccess } = await import('../server/repositories/fileRepository.mjs');
      await assert.rejects(() => assertFileAccess(file.rows[0].id,namesake), e => e.status === 403);
      await assertFileAccess(file.rows[0].id,renamed);
    });
  } finally {
    if (pool) await pool.end();
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.end();
    await fs.rm(uploads, { recursive: true, force: true });
  }
});
