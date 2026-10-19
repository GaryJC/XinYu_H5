import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import pg from "pg";

const adminUrl = process.env.LEGACY_SYNC_TEST_ADMIN_URL;
test("legacy sync timeout recovery, ordered reclaiming and concurrent consumers", { skip: !adminUrl, timeout: 120000 }, async t => {
  const url = new URL(adminUrl);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  const database = `codex_legacy_timeout_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  let pool;
  try {
    await admin.query(`create database "${database}"`);
    url.pathname = `/${database}`;
    pool = new pg.Pool({ connectionString: url.toString() });
    for (const file of (await fs.readdir("supabase/migrations")).filter(f => f.endsWith(".sql") && f !== "202608070005_remove_obsolete_runfeng_sync_role.sql").sort()) {
      await pool.query(await fs.readFile(`supabase/migrations/${file}`, "utf8"));
    }
    const seed = async (id, { age = "11 minutes", status = "processing", revision = 1, latest = revision, type = "created" } = {}) => {
      await pool.query(`insert into work_orders(id,status,advisor,technician,inspector,old_parts_handling,legacy_sync_status,legacy_sync_revision)
        values($1,'已委托','测试顾问','待派工','待检验','环保处理',$2,$3)`, [id, status, latest]);
      await pool.query(`insert into legacy_sync_outbox(event_id,order_id,revision,event_type,payload,status,attempt_count,locked_by,locked_at,
          legacy_reid,legacy_document_no,legacy_dispatch_no)
        values($1,$1,$2,$3,'{"order":{"dispatchNo":"A123"}}',$4,1,'old-consumer',now()-$5::interval,
          $6,201,$7)`, [id, revision, type, status, age, id === 'correction' ? 102 : id === 'ordered' ? 103 : 101, id === 'correction' ? 'A124' : id === 'ordered' ? 'A125' : 'A123']);
    };
    const event = async id => (await pool.query("select * from legacy_sync_outbox where event_id=$1", [id])).rows[0];
    const order = async id => (await pool.query("select * from work_orders where id=$1", [id])).rows[0];
    const recover = async () => Number((await pool.query("select requeue_timed_out_legacy_sync_events() as count")).rows[0].count);
    await t.test("10-minute boundary, recent claims and completed events", async () => {
      await seed("expired"); await seed("recent", { age: "9 minutes" }); await seed("synced", { status: "synced" });
      const before = await event("expired");
      await pool.query("update legacy_sync_outbox set locked_at=now()-interval '10 minutes' where event_id='expired'");
      assert.equal(await recover(), 1);
      const after = await event("expired");
      assert.equal(after.status, "pending"); assert.equal(after.locked_by, null); assert.equal(after.locked_at, null);
      for (const field of ["event_id", "revision", "attempt_count", "payload", "legacy_reid", "legacy_document_no", "legacy_dispatch_no"]) {
        assert.deepEqual(after[field], before[field]);
      }
      assert.equal((await order("expired")).legacy_sync_status, "pending");
      assert.equal((await event("recent")).status, "processing");
      assert.equal((await event("synced")).status, "synced");
      assert.equal(await recover(), 0);
    });
    await t.test("late ACK from previous consumer is rejected and reclaim increments attempts", async () => {
      assert.equal((await pool.query("select acknowledge_legacy_sync_event('expired','old-consumer',101,201,'A123') as ok")).rows[0].ok, false);
      const claimed = (await pool.query("select * from claim_legacy_sync_events('new-consumer',20)")).rows;
      assert.deepEqual(claimed.map(e => e.event_id), ["expired"]);
      assert.equal(claimed[0].attempt_count, 2);
      assert.equal((await order("expired")).legacy_sync_status, "processing");
      assert.equal((await pool.query("select acknowledge_legacy_sync_event('expired','old-consumer',101,201,'A123') as ok")).rows[0].ok, false);
      assert.equal((await pool.query("select acknowledge_legacy_sync_event('expired','new-consumer',101,201,'A123') as ok")).rows[0].ok, true);
    });
    await t.test("updated events retain immutable identity across timeout and ACK", async () => {
      await seed("correction", { type: "updated" });
      const before = await event("correction");
      const rows = (await pool.query("select * from claim_legacy_sync_events('new-consumer',20)")).rows;
      assert.equal(rows[0].event_id, "correction"); assert.equal(rows[0].attempt_count, 2);
      assert.deepEqual(rows[0].payload, before.payload);
      assert.equal((await pool.query("select acknowledge_legacy_sync_event('correction','new-consumer',102,201,'A124') as ok")).rows[0].ok, true);
    });
    await t.test("an expired older revision cannot reset the latest status or allow it to overtake", async () => {
      await seed("ordered", { latest: 2 });
      await pool.query(`insert into legacy_sync_outbox(event_id,order_id,revision,event_type,payload)
        values('ordered-next','ordered',2,'updated','{"order":{"dispatchNo":""}}')`);
      await pool.query("update work_orders set legacy_sync_status='pending' where id='ordered'");
      assert.equal(await recover(), 1);
      assert.equal((await order("ordered")).legacy_sync_status, "pending");
      const rows = (await pool.query("select * from claim_legacy_sync_events('new-consumer',20)")).rows;
      assert.deepEqual(rows.map(e => e.event_id), ["ordered"]);
      assert.equal((await order("ordered")).legacy_sync_status, "pending");
      await pool.query("select acknowledge_legacy_sync_event('ordered','new-consumer',103,201,'A125')");
      const next = (await pool.query("select * from claim_legacy_sync_events('new-consumer',20)")).rows;
      assert.deepEqual(next.map(e => e.event_id), ["ordered-next"]);
      await pool.query("select acknowledge_legacy_sync_event('ordered-next','new-consumer',103,201,'A125')");
    });
    await t.test("locked rows are skipped and concurrent consumers claim each event only once", async () => {
      await seed("locked"); await seed("concurrent-a"); await seed("concurrent-b");
      const locker = await pool.connect();
      try {
        await locker.query("begin");
        await locker.query("select * from legacy_sync_outbox where event_id='locked' for update");
        const results = await Promise.all([pool.query("select * from claim_legacy_sync_events('consumer-a',20)"), pool.query("select * from claim_legacy_sync_events('consumer-b',20)")]);
        const ids = results.flatMap(r => r.rows.map(e => e.event_id)).sort();
        assert.deepEqual(ids, ["concurrent-a", "concurrent-b"]);
        assert.equal((await event("locked")).status, "processing");
      } finally { await locker.query("rollback"); locker.release(); }
      assert.equal(await recover(), 1);
    });
  } finally {
    await pool?.end();
    await admin.query(`drop database if exists "${database}" with (force)`);
    await admin.end();
  }
});
