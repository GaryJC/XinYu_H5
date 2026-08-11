import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildLegacySyncPayload,
  enqueueLegacySyncEvent,
  INSERT_LEGACY_SYNC_EVENT_QUERY
} from "../server/repositories/legacySyncOutboxRepository.mjs";

const order = {
  id: "WT-20260730-001",
  status: "草稿",
  dispatchNo: "",
  arrivalDate: "2026-07-30",
  advisor: "张三",
  department: { code: "A", name: "机电一部" },
  technician: "待派工",
  inspector: "待检验",
  shop: { id: "shop-hq", name: "抚顺路店", address: "抚顺路店", phone: "021-1" },
  vehicle: { plate: "鲁B12345", vin: "LSV12345678901234", mileage: "123", model: "测试车型", modelLegacyCode: "CSCX", purchaseDate: "" },
  customer: { name: "测试客户", legacyCode: "CSKH", phone: "13800000000", contact: "测试客户", address: "" },
  inspection: { belongings: ["行驶证"], fuelLevel: "1/2", exteriorIssues: [] },
  faultDescription: "测试故障",
  repairItems: [{
    id: 7,
    name: "检查发动机",
    laborFee: 80,
    owner: "待派工",
    status: "待派工",
    startAt: "",
    finishAt: "",
    inspector: "待检验"
  }],
  estimatedFee: 80,
  oldPartsHandling: "环保处理",
  estimatedDeliveryAt: "",
  settlementAmount: 0,
  feeNote: "",
  signatures: {},
  createdAt: "2026-07-30T00:00:00.000Z",
  updatedAt: "2026-07-30T00:00:00.000Z"
};

test("legacy sync payload is versioned and preserves structured work-order data", () => {
  const payload = buildLegacySyncPayload({
    eventId: "event-1",
    revision: 3,
    eventType: "created",
    order
  });

  assert.equal(payload.schema, "xinyu.work-order-sync");
  assert.equal(payload.version, 1);
  assert.equal(payload.eventId, "event-1");
  assert.equal(payload.eventType, "created");
  assert.equal(payload.revision, 3);
  assert.equal(payload.order.dispatchNo, "");
  assert.deepEqual(payload.order.department, { code: "A", name: "机电一部" });
  assert.equal(payload.order.customer.legacyCode, "CSKH");
  assert.equal(payload.order.vehicle.modelLegacyCode, "CSCX");
  assert.deepEqual(payload.order.repairItems[0], {
    id: 7,
    itemNo: 1,
    name: "检查发动机",
    laborFee: 80,
    owner: "待派工",
    status: "待派工",
    startAt: "",
    finishAt: "",
    inspector: "待检验"
  });
});

test("only work-order creation enqueues a legacy sync event", async () => {
  const source = await readFile(new URL("../server/db.mjs", import.meta.url), "utf8");
  const enqueueCalls = source.match(/await enqueueLegacySyncEvent\(/g) || [];

  assert.equal(enqueueCalls.length, 1);
  assert.match(
    source,
    /export async function createWorkOrder[\s\S]*?await enqueueLegacySyncEvent\(client, order, "created"\)/
  );
  assert.doesNotMatch(
    source,
    /async function upsertWorkOrder[\s\S]*?await enqueueLegacySyncEvent/
  );
});

test("enqueue increments the PostgreSQL revision and inserts one outbox event", async () => {
  const calls = [];
  const client = {
    async query(query, params) {
      calls.push({ query, params });
      if (calls.length === 1) return { rows: [{ legacy_sync_revision: 4 }] };
      return { rows: [], rowCount: 1 };
    }
  };

  const event = await enqueueLegacySyncEvent(client, order, "created");

  assert.equal(event.revision, 4);
  assert.match(event.eventId, /^[0-9a-f-]{36}$/);
  assert.match(calls[0].query, /legacy_sync_revision = legacy_sync_revision \+ 1/i);
  assert.equal(calls[0].params[0], order.id);
  assert.equal(calls[1].query, INSERT_LEGACY_SYNC_EVENT_QUERY);
  const payload = JSON.parse(calls[1].params[4]);
  assert.equal(payload.eventType, "created");
  assert.equal(payload.revision, 4);
  assert.equal(payload.order.id, order.id);
});

test("outbox migration provides ordered claiming and ACK backfill", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/202607300001_legacy_sync_outbox.sql", import.meta.url),
    "utf8"
  );

  assert.match(migration, /create table if not exists legacy_sync_outbox/i);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /earlier\.revision < candidate\.revision/i);
  assert.match(migration, /create or replace function acknowledge_legacy_sync_event/i);
  assert.match(migration, /dispatch_no = coalesce\(nullif\(new\.legacy_dispatch_no/i);
});

test("customer legacy code migration preserves the matched khxxb bm", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/202608110001_work_order_customer_legacy_code.sql", import.meta.url),
    "utf8"
  );

  assert.match(migration, /add column if not exists customer_legacy_code text not null default ''/i);
  assert.match(migration, /idx_work_orders_customer_legacy_code/i);
});

test("vehicle model legacy code migration preserves the matched cxb bh", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/202608110002_work_order_vehicle_model_legacy_code.sql", import.meta.url),
    "utf8"
  );
  assert.match(migration, /add column if not exists vehicle_model_legacy_code text not null default ''/i);
  assert.match(migration, /idx_work_orders_vehicle_model_legacy_code/i);
});

test("batch result migration ACKs and fails up to 100 claimed events", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/202608070002_batch_legacy_sync_results.sql", import.meta.url),
    "utf8"
  );

  assert.match(migration, /create or replace function acknowledge_legacy_sync_events\(/i);
  assert.match(migration, /create or replace function fail_legacy_sync_events\(/i);
  assert.match(migration, /jsonb_array_length\(results\) > 100/i);
  assert.match(migration, /jsonb_array_length\(failures\) > 100/i);
  assert.match(migration, /event\.status = 'processing'/i);
  assert.match(migration, /event\.locked_by = btrim\(consumer_id\)/i);
  assert.match(migration, /returns table\(event_id text, acknowledged boolean\)/i);
  assert.match(migration, /returns table\(event_id text, failed boolean\)/i);
});
