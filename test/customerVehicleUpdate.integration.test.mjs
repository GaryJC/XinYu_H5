import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import pg from "pg";

const adminUrl = process.env.CUSTOMER_VEHICLE_TEST_ADMIN_URL;
test("customer-vehicle correction transactions, concurrency, ordered outbox and ACK identity", { skip: !adminUrl, timeout: 120000 }, async t => {
  const url = new URL(adminUrl);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  const name = `codex_customer_vehicle_test_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  let pool;
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
    url.pathname = `/${name}`;
    process.env.DATABASE_URL = url.toString();
    ({ pool } = await import("../server/database/pool.mjs"));
    for (const file of (await fs.readdir("supabase/migrations")).filter(f => f.endsWith(".sql") && f !== "202608070005_remove_obsolete_runfeng_sync_role.sql").sort()) {
      await pool.query(await fs.readFile(`supabase/migrations/${file}`, "utf8"));
    }
    const { updateCustomerVehicle: update } = await import("../server/services/customerVehicleUpdateService.mjs");
    const { refreshWorkOrderFromLegacy: refresh } = await import("../server/services/workOrderRefreshService.mjs");
    const actor = { id: "manager", name: "测试管理员", role: "manager", active: true, shopId: "shop-hq" };
    const input = { expectedRevision: 1, contact: "新联系人", phone: "13000000001", model: "新车型", modelLegacyCode: "NEW",
      organization: "新单位", organizationLegacyCode: "neworg" };
    const refs = async kind => ({ value: kind === "model" ? "新车型" : "新单位", code: kind === "model" ? "NEW" : "neworg" });
    const deps = { enabled: true, readReference: refs };
    await pool.query(`insert into work_orders(id,status,advisor,technician,inspector,old_parts_handling,
      legacy_sync_status,legacy_sync_revision,legacy_reid,legacy_document_no,dispatch_no,vehicle_plate,
      vehicle_model,vehicle_model_legacy_code,customer_name,customer_legacy_code,customer_contact,customer_phone,estimated_fee)
      values('test-order','维修中','测试顾问','测试技师','待检验','环保处理','synced',1,101,201,'A123','鲁B12345',
        '旧车型','OLD','旧单位','oldorg','旧联系人','13000000000',100)`);
    await pool.query(`insert into legacy_sync_outbox(event_id,order_id,revision,event_type,payload,status,legacy_reid,legacy_document_no,legacy_dispatch_no)
      values('original-created','test-order',1,'created','{"signed":"original"}','synced',101,201,'A123')`);
    await pool.query(`insert into signatures(order_id,signer_type,signer_name) values('test-order','customer','原签署人')`);
    await pool.query(`insert into repair_items(order_id,client_item_id,item_no,name,status,start_at,owner)
      values('test-order',7,1,'检查制动','维修中','2026-10-15 10:00','测试技师')`);
    const originalEvent = (await pool.query("select * from legacy_sync_outbox")).rows;
    const originalSignature = (await pool.query("select * from signatures")).rows;
    const originalItems = (await pool.query("select * from repair_items")).rows;
    const snapshot = async () => (await pool.query("select * from work_orders")).rows;
    await t.test("disabled rollout, authorization and failed reference checks never change local data", async () => {
      const before = await snapshot();
      await assert.rejects(() => update("test-order", input, actor, { ...deps, enabled: false }), /尚未启用/);
      for (const patch of [{ shopId: "other" }, { role: "technician" }, { active: false }, { role: "advisor", name: "其他顾问" }]) {
        await assert.rejects(() => update("test-order", input, { ...actor, ...patch }, deps), error => error.status === 403);
      }
      await assert.rejects(() => update("test-order", input, actor, { ...deps, readReference: async () => undefined }), /不一致/);
      await assert.rejects(() => update("test-order", input, actor, { ...deps, readReference: async () => { throw new Error("Runfeng unavailable"); } }), /unavailable/);
      assert.deepEqual(await snapshot(), before);
    });
    await t.test("outbox failure rolls back correction metadata, audit and all four fields", async () => {
      const before = await snapshot();
      await pool.query(`create function reject_test_update() returns trigger language plpgsql as $$ begin raise exception 'test outbox failure'; end $$`);
      await pool.query("create trigger reject_test_update before insert on legacy_sync_outbox for each row execute function reject_test_update()");
      await assert.rejects(() => update("test-order", input, actor, deps), /test outbox failure/);
      assert.deepEqual(await snapshot(), before);
      assert.equal((await pool.query("select count(*) from audit_logs")).rows[0].count, "0");
      await pool.query("drop trigger reject_test_update on legacy_sync_outbox");
    });
    await t.test("two concurrent saves produce exactly one new event and preserve signed content and workflow", async () => {
      const results = await Promise.allSettled([update("test-order", input, actor, deps), update("test-order", input, actor, deps)]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      assert.equal(results.filter(result => result.status === "rejected").length, 1);
      const event = (await pool.query("select * from legacy_sync_outbox where event_type='updated'")).rows[0];
      assert.equal(event.revision, "2");
      assert.equal(event.legacy_dispatch_no, "A123");
      assert.equal(event.legacy_reid, "101");
      assert.equal(event.payload.eventType, "updated");
      assert.equal(event.payload.version, 1);
      assert.equal(event.payload.order.dispatchNo, "A123");
      assert.equal(event.payload.order.customer.contact, input.contact);
      assert.equal(event.payload.order.customer.phone, input.phone);
      assert.equal(event.payload.order.vehicle.model, input.model);
      assert.equal(event.payload.order.customer.legacyCode, input.organizationLegacyCode);
      assert.equal(event.payload.order.status, "维修中");
      assert.equal(event.payload.order.estimatedFee, 100);
      assert.deepEqual((await pool.query("select * from signatures")).rows, originalSignature);
      assert.deepEqual((await pool.query("select * from repair_items")).rows, originalItems);
      assert.deepEqual((await pool.query("select * from legacy_sync_outbox where event_id='original-created'")).rows, originalEvent);
      const audit = (await pool.query("select action from audit_logs")).rows[0].action;
      assert.match(audit, /旧联系人/); assert.match(audit, /新联系人/);
      assert.equal((await snapshot())[0].customer_vehicle_updated_by, actor.name);
    });
    let eventId;
    await t.test("processing permits no-op edits, reverse refresh stays blocked and failed updates require retry", async () => {
      const rows = (await pool.query("select * from claim_legacy_sync_events('test-consumer',20)")).rows;
      assert.equal(rows.length, 1); eventId = rows[0].event_id;
      assert.equal((await pool.query("select * from claim_legacy_sync_events('other-consumer',20)")).rows.length, 0);
      await update("test-order", { ...input, expectedRevision: 2 }, actor, deps);
      await assert.rejects(() => refresh("test-order", actor, { readSource: async () => { throw new Error("must not read Runfeng"); } }), error => error.status === 409);
      assert.equal((await pool.query("select fail_legacy_sync_event($1,'test-consumer','temporary failure',0) as result", [eventId])).rows[0].result, true);
      await assert.rejects(() => update("test-order", { ...input, expectedRevision: 2 }, actor, deps), error => error.status === 409);
      assert.equal((await pool.query("select * from claim_legacy_sync_events('test-consumer',20)")).rows[0].event_id, eventId);
    });
    await t.test("ACK must retain original reid/dh/pgd and repeating ACK never creates events", async () => {
      for (const ids of [[999,201,"A123"],[101,999,"A123"],[101,201,"A999"]]) {
        await assert.rejects(() => pool.query("select acknowledge_legacy_sync_event($1,'test-consumer',$2,$3,$4)", [eventId,...ids]), /retain original/);
      }
      assert.equal((await pool.query("select acknowledge_legacy_sync_event($1,'test-consumer',101,201,'A123') as result", [eventId])).rows[0].result, true);
      assert.equal((await pool.query("select acknowledge_legacy_sync_event($1,'test-consumer',101,201,'A123') as result", [eventId])).rows[0].result, false);
      assert.equal((await snapshot())[0].legacy_sync_status, "synced");
      assert.equal((await pool.query("select count(*) from legacy_sync_outbox")).rows[0].count, "2");
    });
    await t.test("no-op saves and stale revisions cannot create further events", async () => {
      const before = await snapshot();
      await update("test-order", { ...input, expectedRevision: 2 }, actor, deps);
      assert.deepEqual(await snapshot(), before);
      await assert.rejects(() => update("test-order", input, actor, deps), /刷新/);
      assert.equal((await pool.query("select count(*) from legacy_sync_outbox")).rows[0].count, "2");
    });
    await t.test("reverse refresh retains corrected values even when Runfeng sends old customer and vehicle data", async () => {
      const source = { originalPlate: "鲁B12345", header: { reid:101,dh:201,pgd:"A123",ch:"鲁B12345",jcrq:"20261015",fyhj:100,lxr:"旧联系人",lxdh:"旧电话",ssdw:"oldorg" },
        vehicle:{model_name:"旧车型",model_code:"OLD",sbdm:"VIN"},customer:{mc:"旧单位"},items:[{reid:301,hh:"检查制动",je:100}] };
      const result = await refresh("test-order", actor, { readSource: async () => source });
      assert.equal(result.customer.contact, input.contact); assert.equal(result.customer.phone, input.phone);
      assert.equal(result.customer.name, input.organization); assert.equal(result.customer.legacyCode, input.organizationLegacyCode);
      assert.equal(result.vehicle.model, input.model); assert.equal(result.vehicle.modelLegacyCode, input.modelLegacyCode);
    });
    await t.test("each field can be corrected independently without modifying another historical order for the same plate", async () => {
      await pool.query(`insert into work_orders(id,status,advisor,technician,inspector,old_parts_handling,vehicle_plate,customer_contact)
        values('historical-order','完成','历史顾问','历史技师','历史检验','环保处理','鲁B12345','历史联系人')`);
      const history = (await pool.query("select * from work_orders where id='historical-order'")).rows;
      let revision = 2;
      let current = { ...input };
      for (const patch of [{ contact: "第二位联系人" }, { phone: "0532-12345678" },
        { model: "另一车型", modelLegacyCode: "OTHER" }, { organization: "另一单位", organizationLegacyCode: "otherorg" }]) {
        current = { ...current, ...patch, expectedRevision: revision };
        const next = await update("test-order", current, actor, { enabled: true, readReference: async kind => ({
          value: kind === "model" ? current.model : current.organization,
          code: kind === "model" ? current.modelLegacyCode : current.organizationLegacyCode
        }) });
        assert.equal(next.customer.contact, current.contact); assert.equal(next.customer.phone, current.phone);
        assert.equal(next.customer.name, current.organization); assert.equal(next.vehicle.model, current.model);
        assert.equal(next.legacySyncRevision, ++revision);
        const event = (await pool.query("select * from claim_legacy_sync_events('test-consumer',20)")).rows[0];
        await pool.query("select acknowledge_legacy_sync_event($1,'test-consumer',101,201,'A123')", [event.event_id]);
        assert.deepEqual((await pool.query("select * from work_orders where id='historical-order'")).rows, history);
      }
    });
    for (const initial of ["pending", "processing"]) await t.test(`${initial} first-time orders accept repeated edits and claim corrections only after original ACK`, async () => {
      const id = `queued-${initial}`;
      const dispatch = initial === "pending" ? "A999" : "A998";
      const reid = initial === "pending" ? 301 : 302;
      const document = initial === "pending" ? 401 : 402;
      const ack = eventId => pool.query("select acknowledge_legacy_sync_event($1,'queue-consumer',$2,$3,$4)", [eventId,reid,document,dispatch]);
      await pool.query(`insert into work_orders(id,status,advisor,technician,inspector,old_parts_handling,legacy_sync_status,legacy_sync_revision)
        values($1,'已委托','测试顾问','待派工','待检验','环保处理','pending',1)`, [id]);
      const original = { order: { dispatchNo: "", customer: { contact: "原签署联系人" } } };
      await pool.query(`insert into legacy_sync_outbox(event_id,order_id,revision,event_type,payload)
        values($1,$2,1,'created',$3)`, [`created-${id}`, id, original]);
      if (initial === "processing") await pool.query("select * from claim_legacy_sync_events('queue-consumer',20)");
      const first = await update(id, input, actor, deps);
      assert.equal(first.legacySyncRevision, 2);
      assert.equal(first.customer.contact, input.contact);
      const unlinked = (await pool.query("select * from legacy_sync_outbox where order_id=$1 and revision=2", [id])).rows[0];
      assert.equal(unlinked.status, "pending"); assert.equal(unlinked.legacy_reid, null);
      assert.equal(unlinked.payload.order.dispatchNo, "");
      if (initial === "pending") {
        const claimed = (await pool.query("select * from claim_legacy_sync_events('queue-consumer',20)")).rows;
        assert.equal(claimed.length, 1); assert.equal(claimed[0].event_type, "created");
      }
      const final = await update(id, { ...input, expectedRevision: 2, contact: "最后确认的联系人" }, actor, deps);
      assert.equal(final.legacySyncRevision, 3);
      await assert.rejects(() => update(id, input, actor, deps), /刷新/);
      assert.equal((await pool.query("select * from claim_legacy_sync_events('other-consumer',20)")).rows.length, 0);
      assert.deepEqual((await pool.query("select payload from legacy_sync_outbox where event_id=$1", [`created-${id}`])).rows[0].payload, original);
      await ack(`created-${id}`);
      const latest = (await pool.query("select * from work_orders where id=$1", [id])).rows[0];
      assert.equal(latest.legacy_sync_status, "pending"); assert.equal(latest.customer_contact, "最后确认的联系人");
      const second = (await pool.query("select * from claim_legacy_sync_events('queue-consumer',20)")).rows;
      assert.equal(second.length, 1); assert.equal(second[0].revision, "2");
      assert.equal(second[0].legacy_reid, String(reid)); assert.equal(second[0].legacy_dispatch_no, dispatch);
      assert.equal(second[0].payload.order.dispatchNo, dispatch);
      assert.equal(second[0].payload.order.customer.contact, input.contact);
      assert.equal((await pool.query("select * from claim_legacy_sync_events('other-consumer',20)")).rows.length, 0);
      await ack(second[0].event_id);
      const third = (await pool.query("select * from claim_legacy_sync_events('queue-consumer',20)")).rows[0];
      assert.equal(third.revision, "3"); assert.equal(third.payload.order.customer.contact, "最后确认的联系人");
      assert.equal(third.payload.order.dispatchNo, dispatch);
      await ack(third.event_id);
      assert.equal((await pool.query("select legacy_sync_status from work_orders where id=$1", [id])).rows[0].legacy_sync_status, "synced");
    });
  } finally {
    if (pool) await pool.end();
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.end();
  }
});
