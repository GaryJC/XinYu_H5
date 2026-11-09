import * as legacyInputValidation from '../shared/legacyInputValidation.mjs';
import * as vehiclePlateValidation from '../shared/vehiclePlateValidation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import vm from 'node:vm';
import ts from 'typescript';
import { pendingRepairNameMaxLength } from '../shared/pendingRepairLimits.mjs';

async function loadDraftValidation() {
  const source = await fs.readFile(new URL('../client/src/features/work-orders/domain/workOrderDomain.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, require: name => {
    if (name === '../../../../../shared/legacyInputValidation.mjs') return legacyInputValidation;
    if (name === '../../../../../shared/vehiclePlateValidation.mjs') return vehiclePlateValidation;
    if (name === './repairItems') return { filterEmptyRepairItems: rows => rows.filter(row => row.name.trim() || Number(row.laborFee || 0) !== 0) };
    if (name.includes('pendingRepairLimits')) return { pendingRepairNameMaxLength };
    if (name.includes('dispatchAvailability')) return { dispatchEnabled: false };
    if (name.includes('repairCompletion')) return {};
    throw new Error(`Unexpected import: ${name}`);
  } });
  return exports.validateWorkOrderDraft;
}

function openingDraft(name, actor) {
  return { shop: { id: 'shop-hq' }, advisor: actor.name, department: { code: 'D1', name: '维修部' },
    vehicle: { plate: '鲁BTEST', vin: 'LSVAB1234A1234567', mileage: '1000', model: '车型', modelLegacyCode: 'M1' },
    customer: { name: '单位', legacyCode: 'C1', phone: '13800000000' },
    repairItems: [{ id: 1, name, laborFee: 0 }], pendingRepairs: [] };
}

test('opening form validation uses the repair workflow name limit', async () => {
  const validate = await loadDraftValidation();
  const draft = openingDraft('修'.repeat(100), { name: '顾问' });
  assert.equal(validate(draft).length, 0);
  assert.ok(validate({ ...draft, repairItems: [{ id: 1, name: '修'.repeat(101) }] }).some(error => /100/.test(error)));
  assert.ok(validate({ ...draft, repairItems: [], pendingRepairs: [{ id: 'p', name: '修'.repeat(97), state: 'pending', scheduled: false }] }).some(error => /96/.test(error)));
});

const adminUrl = process.env.ORDER_REVIEW_TEST_ADMIN_URL;
test('opening project validation and supplemental signature correction transactions', { skip: !adminUrl, timeout: 120000 }, async t => {
  const url = new URL(adminUrl);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  const name = `codex_order_review_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
  const connectionsClosed = [];
  let pool;
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
    const db = await import('../server/db.mjs');
    const dispatch = await import('../server/services/dispatchService.mjs');
    const { loadCustomerSignature } = await import('../server/services/customerSignatureService.mjs');
    const { updateCustomerVehicle } = await import('../server/services/customerVehicleUpdateService.mjs');
    const actor = { id: 'signature-manager', name: '补签测试管理员', role: 'manager', active: true, shopId: 'shop-hq' };
    await pool.query("insert into users(id,name,role,shop_id,active) values($1,$2,'manager','shop-hq',true)", [actor.id, actor.name]);
    const technician = { id: 'opening-technician', name: '开单测试维修工', role: 'technician', active: true, shopId: 'shop-hq' };
    await pool.query("insert into users(id,name,role,shop_id,active,legacy_employee_code,legacy_employee_name,legacy_employee_department,legacy_employee_bound_at) values($1,$2,'technician','shop-hq',true,'T001',$3,'测试部门',now())", [technician.id, technician.name, technician.name]);
    const before = { expectedRevision: 1, contact: '原联系人', phone: '13800000000' };
    const change = { ...before, contact: '新联系人', phone: '13900000000' };
    const deps = { enabled: true };
    let sequence = 100;
    async function seed() {
      const id = `order-${randomUUID()}`, fileId = randomUUID();
      const legacyId = ++sequence, dispatchNo = `A${legacyId}`;
      await pool.query(`insert into work_orders(id,status,advisor,technician,inspector,old_parts_handling,
        legacy_sync_status,legacy_sync_revision,legacy_reid,legacy_document_no,dispatch_no,vehicle_plate,
        vehicle_model,vehicle_model_legacy_code,customer_name,customer_legacy_code,customer_contact,customer_phone)
        values($1,'维修中',$2,'测试技师','待检验','客户带走','synced',1,$3,$4,$5,'鲁BTEST',
          '原车型','OLD','原单位','ORG1','原联系人','13800000000')`, [id, actor.name, legacyId, legacyId + 1000, dispatchNo]);
      await pool.query("insert into legacy_sync_outbox(event_id,order_id,revision,event_type,payload,status,legacy_reid,legacy_document_no,legacy_dispatch_no) values($1,$2,1,'created','{}','synced',$3,$4,$5)", [randomUUID(), id, legacyId, legacyId + 1000, dispatchNo]);
      await pool.query("insert into files(id,order_id,kind,storage_provider,bucket,object_key,mime_type,size_bytes,uploaded_by) values($1,$2,'signature_image','local','','fixture','image/png',8,$3)", [fileId, id, actor.id]);
      const session = await db.createSignatureTokenForOrder(id, actor.name, { signatureMode: 'remote' });
      return { id, fileId, token: session.signatureToken };
    }
    async function tokenState(token) {
      return (await pool.query('select used,expires_at from signature_tokens where token=$1', [token])).rows[0];
    }
    await t.test('a previously opened customer page cannot sign after its contact details change', async () => {
      const { id, token, fileId } = await seed();
      const preview = await loadCustomerSignature(token);
      assert.equal(preview.order.customerName, '原单位');
      assert.equal(preview.order.vehicle.model, '原车型');
      const corrected = await updateCustomerVehicle(id, change, actor, deps);
      assert.equal(corrected.status, '维修中');
      assert.equal(corrected.customer.name, '原单位');
      let created = false;
      await assert.rejects(() => db.signWorkOrderByToken(token, null, null, async () => { created = true; return { id: fileId }; }), error => error.status === 404);
      assert.equal(created, false, 'stale public signature is rejected before storing an image');
      await assert.rejects(() => loadCustomerSignature(token), error => error.status === 404);
      assert.equal((await tokenState(token)).used, false);
      assert.equal((await pool.query('select count(*) from signatures where order_id=$1', [id])).rows[0].count, '0');
      const renewed = await db.createSignatureTokenForOrder(id, actor.name, { signatureMode: 'remote' });
      assert.notEqual(renewed.signatureToken, token);
      assert.equal((await loadCustomerSignature(renewed.signatureToken)).order.customerName, '原单位');
      const signed = await db.signWorkOrderByToken(renewed.signatureToken, null, null, async () => ({ id: fileId }));
      assert.equal(signed.status, '维修中');
      assert.equal(signed.customerSignatureReview.state, 'pending');
      assert.equal(signed.signatures.customer, '原单位');
    });
    await t.test('unchanged saves retain the current supplemental session', async () => {
      const { id, token } = await seed();
      const state = await tokenState(token);
      await updateCustomerVehicle(id, before, actor, { enabled: true, readReference: async () => { throw new Error('No-op must not read external references'); } });
      assert.deepEqual(await tokenState(token), state);
      assert.equal((await loadCustomerSignature(token)).state, 'pending');
    });
    await t.test('a failed correction preserves both the original fields and the signing session', async () => {
      const { id, token } = await seed();
      const state = await tokenState(token);
      await pool.query("create function reject_correction_event() returns trigger language plpgsql as $$ begin raise exception 'test outbox failure'; end $$");
      await pool.query('create trigger reject_correction_event before insert on legacy_sync_outbox for each row execute function reject_correction_event()');
      try {
        await assert.rejects(() => updateCustomerVehicle(id, change, actor, deps), /test outbox failure/);
      } finally {
        await pool.query('drop trigger reject_correction_event on legacy_sync_outbox');
      }
      assert.deepEqual(await tokenState(token), state);
      const original = await db.findWorkOrderById(pool, id);
      assert.equal(original.customer.name, '原单位');
      assert.equal(original.vehicle.model, '原车型');
      assert.equal((await loadCustomerSignature(token)).state, 'pending');
      assert.equal((await pool.query('select count(*) from audit_logs where order_id=$1 and action like $2', [id, '修改联系人和电话%'])).rows[0].count, '0');
    });
    await t.test('already recorded and confirmed signatures remain historical evidence', async () => {
      const { id, token, fileId } = await seed();
      const historicalName = '历史'.repeat(80);
      await pool.query("insert into repair_items(order_id,client_item_id,item_no,name,status) values($1,1,1,$2,'维修中')", [id, historicalName]);
      await db.signWorkOrderByToken(token, '原单位签署人', fileId, undefined, actor);
      const signature = (await pool.query('select * from signatures where order_id=$1', [id])).rows;
      const state = await tokenState(token);
      const original = await db.findWorkOrderById(pool, id);
      const corrected = await updateCustomerVehicle(id, change, actor, deps);
      assert.deepEqual((await pool.query('select * from signatures where order_id=$1', [id])).rows, signature);
      assert.deepEqual(corrected.customerSignatureReview, original.customerSignatureReview);
      assert.deepEqual(await tokenState(token), state);
      assert.equal(corrected.repairItems[0].name, historicalName);
    });
    async function dispatchOpening(order) {
      const photos = {};
      for (const [slot, kind] of [['front45', 'repair_order_photo'], ['rear45', 'repair_order_photo'], ['license', 'vehicle_license'], ['signature', 'signature_image'], ['nameplate', 'vehicle_nameplate_photo'], ['progress', 'repair_progress_photo']]) {
        const fileId = randomUUID();
        await pool.query("insert into files(id,order_id,kind,storage_provider,bucket,object_key,mime_type,size_bytes,uploaded_by) values($1,$2,$3,'local','','fixture','image/png',8,$4)", [fileId, order.id, kind, ['nameplate', 'progress'].includes(slot) ? technician.id : actor.id]);
        photos[slot] = fileId;
      }
      await pool.query('update work_orders set inspection=$2 where id=$1', [order.id, { preRepairPhotos: { front45: photos.front45, rear45: photos.rear45 } }]);
      const session = await db.createSignatureTokenForOrder(order.id, actor.name, { signatureMode: 'onsite' });
      await db.signWorkOrderByToken(session.signatureToken, '单位', photos.signature, undefined, actor);
      let task = (await dispatch.executeDispatchAction(actor, order.id, { action: 'assign', expectedVersion: 0, requestId: randomUUID(), technicianIds: [technician.id], dueAt: new Date(Date.now() + 86400000).toISOString() })).task;
      task = (await dispatch.executeDispatchAction(technician, order.id, { action: 'accept', expectedVersion: task.version, requestId: randomUUID(), partsRequirement: { mode: 'none', items: [], photoIds: [] } })).task;
      return task;
    }
    await t.test('rejects an overlong new opening before it can become an uneditable repair project', async () => {
      let accepted;
      try { accepted = await db.createWorkOrder(openingDraft('修'.repeat(101), actor), actor.name, actor); }
      catch (error) { assert.equal(error.status, 400); assert.match(error.message, /100/); return; }
      const task = await dispatchOpening(accepted);
      await assert.rejects(() => dispatch.executeDispatchAction(technician, accepted.id, { action: 'edit-repair-items', expectedVersion: task.version, requestId: randomUUID(), repairItems: task.items }), error => error.status === 400 && /100/.test(error.message));
      assert.fail('Opening accepted 101 characters, but the subsequent repair edit rejected the same unchanged name');
    });
    await t.test('100-character openings survive saving, signing, dispatch, editing and completion submission', async () => {
      const name = '修'.repeat(100);
      let order = await db.createWorkOrder(openingDraft(name, actor), actor.name, actor);
      order = await db.updateWorkOrder({ ...order, faultDescription: '保存草稿' }, actor.name, '保存草稿', actor);
      let task = await dispatchOpening(order);
      task = (await dispatch.executeDispatchAction(technician, order.id, { action: 'edit-repair-items', expectedVersion: task.version, requestId: randomUUID(), repairItems: task.items })).task;
      task = (await dispatch.executeDispatchAction(technician, order.id, { action: 'submit-order', expectedVersion: task.version, requestId: randomUUID() })).task;
      assert.equal(task.items[0].name, name);
      assert.equal(task.items[0].status, '待检验');
    });
    await t.test('failed overlong edits preserve existing draft and historical names', async () => {
      const order = await db.createWorkOrder(openingDraft('原项目', actor), actor.name, actor);
      const state = await db.findWorkOrderById(pool, order.id);
      await assert.rejects(() => db.updateWorkOrder({ ...state, repairItems: [{ ...state.repairItems[0], name: '修'.repeat(101) }] }, actor.name, '长名称', actor), error => error.status === 400);
      assert.equal((await db.findWorkOrderById(pool, order.id)).repairItems[0].name, '原项目');
      await pool.query('update repair_items set name=$2 where order_id=$1', [order.id, '历史'.repeat(80)]);
      const historical = await db.findWorkOrderById(pool, order.id);
      assert.equal(historical.repairItems[0].name, '历史'.repeat(80));
      await assert.rejects(() => db.updateWorkOrder(historical, actor.name, '保留旧名称', actor), error => error.status === 400);
      assert.equal((await db.findWorkOrderById(pool, order.id)).repairItems[0].name, '历史'.repeat(80));
    });
  } finally {
    if (pool) await pool.end();
    await Promise.all(connectionsClosed);
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.end();
  }
});
