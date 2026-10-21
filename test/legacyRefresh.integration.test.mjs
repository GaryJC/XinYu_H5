import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import pg from "pg";
const adminUrl = process.env.RUNFENG_REFRESH_TEST_ADMIN_URL;
// Explicitly opt into a disposable local database, never use application .env URLs.
test("Runfeng refresh transaction, item identities, permissions and rollback", { skip: !adminUrl, timeout: 120000 }, async t => {
  const url = new URL(adminUrl);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  const name = `codex_refresh_test_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  let pool;
  await admin.connect();
  try {
    await admin.query(`create database "${name}"`);
    url.pathname = `/${name}`; process.env.DATABASE_URL = url.toString();
    ({ pool } = await import("../server/database/pool.mjs"));
    for (const file of (await fs.readdir("supabase/migrations")).filter(f => f.endsWith(".sql") && f !== "202608070005_remove_obsolete_runfeng_sync_role.sql").sort()) {
      await pool.query(await fs.readFile(`supabase/migrations/${file}`, "utf8"));
    }
    const { refreshWorkOrderFromLegacy: refresh } = await import("../server/services/workOrderRefreshService.mjs");
    const { transitionWorkOrder } = await import("../server/db.mjs");
    const actor = { id: "manager", name: "测试管理员", role: "manager", active: true, shopId: "shop-hq" };
    await pool.query(`insert into work_orders(id,status,advisor,technician,inspector,old_parts_handling,legacy_sync_status,legacy_reid,legacy_document_no,dispatch_no)
      values('test-order','已委托','测试顾问','测试技师','待检验','环保处理','synced',101,201,'A123')`);
    await pool.query(`insert into repair_items(order_id,client_item_id,item_no,name,status,start_at,owner)
      values('test-order',7,1,'检查制动','维修中','2026-10-15 10:00','测试技师')`);
    await pool.query(`insert into dispatch_tasks(order_id,shop_id,stage,version,data)
      values('test-order','shop-hq','维修中',3,'{"items":[{"id":7,"name":"检查制动","status":"维修中","startAt":"2026-10-15 10:00","startedBy":"tech"}]}')`);
    await pool.query(`insert into signatures(order_id,signer_type,signer_name) values('test-order','customer','测试车主')`);
    const signature = (await pool.query("select * from signatures")).rows;
    const snapshot = { header: { reid: 101, dh: 201, pgd: "A123", ch: "鲁B12345", lc: "12500", jcrq: "20261015", fyhj: 120, wxnr: "更新后的故障" },
      vehicle: { sbdm: "LSVAB1234A1234567", model_name: "测试车型", model_code: "TEST" },
      customer: { mc: "测试车主", jydz: "测试地址" }, items: [{ reid: 301, hh: "检查制动", je: 120 }] };
    const readSource = async () => structuredClone(snapshot);
    await t.test("updates content without touching signatures, execution state or outbound sync", async () => {
      const updated = await refresh("test-order", actor, { readSource });
      assert.equal(updated.faultDescription, "更新后的故障");
      assert.equal(updated.vehicle.mileage, "12500");
      assert.equal(updated.status, "已委托");
      assert.equal(updated.advisor, "测试顾问");
      assert.equal(updated.repairItems[0].id, 7);
      assert.equal(updated.repairItems[0].startAt, "2026-10-15 10:00");
      assert.deepEqual((await pool.query("select * from signatures")).rows, signature);
      const task = (await pool.query("select * from dispatch_tasks")).rows[0];
      assert.equal(task.version, 4); assert.equal(task.data.items[0].startedBy, "tech");
      assert.equal((await pool.query("select count(*) from legacy_sync_outbox")).rows[0].count, "0");
    });
    await t.test("later renames retain stable local ids and task history", async () => {
      snapshot.items[0].hh = "重新编辑的维修名称";
      await refresh("test-order", actor, { readSource });
      const item = (await pool.query("select * from repair_items")).rows[0];
      assert.equal(item.legacy_item_reid, 301); assert.equal(Number(item.client_item_id), 7);
      const task = (await pool.query("select * from dispatch_tasks")).rows[0];
      assert.equal(task.data.items[0].name, "重新编辑的维修名称");
      assert.equal(task.data.items[0].startedBy, "tech");
    });
    await t.test("transition saves preserve the reverse-sync identity", async () => {
      await transitionWorkOrder("test-order", "待派工", actor.name, "测试流转");
      assert.equal((await pool.query("select legacy_item_reid from repair_items")).rows[0].legacy_item_reid, 301);
    });
    await t.test("permission checks happen before reading Runfeng", async () => {
      for (const user of [{ ...actor, shopId: "other" }, { ...actor, role: "technician" }, { ...actor, role: "advisor", name: "其他顾问" }]) {
        await assert.rejects(() => refresh("test-order", user, { readSource: async () => { throw new Error("must not read"); } }), /无权/);
      }
    });
    await t.test("source failure and project conflicts roll back the entire order", async () => {
      const before = (await pool.query("select * from work_orders")).rows;
      await assert.rejects(() => refresh("test-order", actor, { readSource: async () => { throw new Error("network unavailable"); } }), /network unavailable/);
      snapshot.items.push({ reid: 302, hh: "新增项目", je: 0 }); snapshot.header.wxnr = "must rollback";
      await assert.rejects(() => refresh("test-order", actor, { readSource }), /已有派工/);
      assert.deepEqual((await pool.query("select * from work_orders")).rows, before);
      snapshot.items.pop();
    });
    await t.test("unassigned project replacement updates both database rows and dispatch JSON", async () => {
      await pool.query(`insert into work_orders(id,status,advisor,technician,inspector,old_parts_handling,legacy_sync_status,legacy_reid,legacy_document_no)
        values('unassigned','已委托','测试顾问','待派工','待检验','环保处理','synced',102,202)`);
      await pool.query(`insert into repair_items(order_id,client_item_id,item_no,name) values('unassigned',1,1,'旧项目')`);
      await pool.query(`insert into dispatch_tasks(order_id,shop_id,stage,data)
        values('unassigned','shop-hq','待派工','{"items":[{"id":1,"name":"旧项目","status":"待派工"}]}')`);
      const source = structuredClone(snapshot);
      source.header = { ...source.header, reid: 102, dh: 202, pgd: "A124" };
      source.items = [{ reid: 302, hh: "新增项目", je: 0 }];
      const updated = await refresh("unassigned", actor, { readSource: async () => source });
      assert.equal(updated.repairItems.length, 1);
      assert.equal(updated.repairItems[0].name, "新增项目");
      const task = (await pool.query("select data from dispatch_tasks where order_id='unassigned'")).rows[0];
      assert.equal(task.data.items.length, 1); assert.equal(task.data.items[0].name, "新增项目");
      assert.equal(task.data.items[0].status, "待派工");
    });
    await t.test("refresh preserves independent rework items, progress and parts in every stage", async () => {
      const base = { repairRound: 1, items: [
        { id: 7, name: '本轮原项目', status: '维修中', responsibleId: 'tech', startedBy: 'tech' },
        { id: -1, name: '返工新增项目', status: '待开工' }
      ], partsRequirement: { mode: 'list', items: [{name:'配件',quantity:1,unit:'个'}], batch:2, preparedAt:'2026-10-20T00:00:00Z' } };
      for (const stage of ['待接单', '维修中', '暂停', '待检验', '维修完成']) {
        const data=structuredClone(base);
        if(stage==='暂停')data.resumeStage='维修中';
        if(stage==='待检验')data.items.forEach(i=>i.status='待检验');
        await pool.query("update dispatch_tasks set stage=$1,data=$2 where order_id='test-order'",[stage,JSON.stringify(data)]);
        const before=(await pool.query("select version from dispatch_tasks where order_id='test-order'")).rows[0].version;
        await refresh('test-order',actor,{readSource});
        const task=(await pool.query("select * from dispatch_tasks where order_id='test-order'")).rows[0];
        assert.equal(task.stage,stage);assert.equal(task.version,before+1);assert.deepEqual(task.data,data);
      }
    });
    await t.test("pending pushes prevent reverse-sync races", async () => {
      await pool.query("update work_orders set legacy_sync_status='processing' where id='test-order'");
      await assert.rejects(() => refresh("test-order", actor, { readSource }), /推送成功/);
    });
  } finally {
    if (pool) await pool.end();
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.end();
  }
});
