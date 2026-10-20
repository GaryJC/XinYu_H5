import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import pg from "pg";

const adminUrl = process.env.LEGACY_SYNC_TEST_ADMIN_URL;
test("updated JSON identity backfill and first-claim association", { skip: !adminUrl, timeout: 120000 }, async () => {
  const url = new URL(adminUrl);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  const database = `codex_payload_identity_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  let client;
  const migration = "202610190002_updated_payload_legacy_identity.sql";
  try {
    await admin.query(`create database "${database}"`);
    url.pathname = `/${database}`;
    client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    for (const file of (await fs.readdir("supabase/migrations")).filter(f => f.endsWith(".sql") && f !== migration && f !== "202608070005_remove_obsolete_runfeng_sync_role.sql").sort()) {
      await client.query(await fs.readFile(`supabase/migrations/${file}`, "utf8"));
    }
    const business = { order: { dispatchNo: "A123", customer: { contact: "原联系人" }, signatures: { customer: "保留签名" }, repairItems: [{ name: "年审" }] }, eventType: "updated", revision: 2 };
    await client.query(`insert into work_orders(id,status,advisor,technician,inspector,old_parts_handling,legacy_sync_revision)
      values('existing','已委托','顾问','待派工','待检验','环保处理',2),('queued','已委托','顾问','待派工','待检验','环保处理',2)`);
    await client.query(`insert into legacy_sync_outbox(event_id,order_id,revision,event_type,payload,status,attempt_count,locked_by,locked_at,legacy_reid,legacy_document_no,legacy_dispatch_no)
      values('existing','existing',2,'updated',$1,'processing',2,'consumer',now(),101,201,'A123')`, [business]);
    const before = (await client.query("select * from legacy_sync_outbox where event_id='existing'")).rows[0];
    await client.query(await fs.readFile(`supabase/migrations/${migration}`, "utf8"));
    const after = (await client.query("select * from legacy_sync_outbox where event_id='existing'")).rows[0];
    assert.deepEqual(after.payload, { ...business, legacy_reid: 101, legacy_document_no: 201, legacy_dispatch_no: "A123" });
    for (const field of ["event_id", "revision", "status", "attempt_count", "locked_by", "locked_at", "available_at", "legacy_reid", "legacy_document_no", "legacy_dispatch_no"]) assert.deepEqual(after[field], before[field]);
    const audit = (await client.query("select action from audit_logs where order_id='existing'")).rows[0].action;
    assert.deepEqual(JSON.parse(audit.slice(audit.indexOf('：') + 1)).payload, business);

    await client.query(`insert into legacy_sync_outbox(event_id,order_id,revision,event_type,payload)
      values('created','queued',1,'created','{"order":{"dispatchNo":""}}'),('correction','queued',2,'updated',$1)`, [{ ...business, order: { ...business.order, dispatchNo: "" } }]);
    const waiting = (await client.query("select payload from legacy_sync_outbox where event_id='correction'")).rows[0].payload;
    assert.equal(waiting.legacy_reid, null);
    assert.equal(waiting.legacy_document_no, null);
    assert.equal(waiting.legacy_dispatch_no, null);
    assert.equal((await client.query("select * from claim_legacy_sync_events('consumer',20)")).rows[0].event_id, "created");
    await client.query("select acknowledge_legacy_sync_event('created','consumer',102,202,'A124')");
    const claimed = (await client.query("select * from claim_legacy_sync_events('consumer',20)")).rows[0];
    assert.equal(claimed.event_id, "correction");
    assert.equal(claimed.payload.legacy_reid, 102);
    assert.equal(claimed.payload.legacy_document_no, 202);
    assert.equal(claimed.payload.legacy_dispatch_no, "A124");
    assert.equal(claimed.payload.order.dispatchNo, "A124");
    assert.deepEqual(claimed.payload.order.signatures, business.order.signatures);
    await client.query("update legacy_sync_outbox set locked_at=now()-interval '11 minutes', payload=jsonb_set(payload,'{legacy_reid}','999') where event_id='correction'");
    const reclaimed = (await client.query("select * from claim_legacy_sync_events('consumer-2',20)")).rows;
    assert.equal(reclaimed.find(row => row.event_id === "correction").payload.legacy_reid, 102);
    await assert.rejects(() => client.query("update legacy_sync_outbox set legacy_reid=999 where event_id='correction'"), /must retain original/);
  } finally {
    await client?.end();
    await admin.query(`drop database if exists "${database}" with (force)`);
    await admin.end();
  }
});
