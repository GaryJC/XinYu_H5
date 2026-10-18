import test from "node:test";
import assert from "node:assert/strict";
import { parseCustomerVehicleUpdate, assertCustomerVehicleEditable, assertReferenceMatches } from "../server/domain/customerVehicleUpdate.mjs";
import { lockCustomerVehicleOrder } from "../server/repositories/customerVehicleUpdateRepository.mjs";
import { customerVehicleEditEnabled } from "../server/config/customerVehicleEdit.mjs";

const input = { expectedRevision: 1, contact: "张三", phone: "010-12345678", model: "测试车型", modelLegacyCode: "TEST",
  organization: "测试单位", organizationLegacyCode: "testorg" };
const actor = { name: "顾问", role: "advisor", active: true, shopId: "shop-hq" };
const order = { shop_id: "shop-hq", advisor: "顾问", status: "维修中", legacy_sync_status: "synced",
  legacy_sync_revision: 1, legacy_reid: 101, legacy_document_no: 201, dispatch_no: "A123" };

test("customer-vehicle updates require an explicit server-side rollout flag", () => {
  for (const env of [{}, { RUNFENG_CUSTOMER_VEHICLE_UPDATE_ENABLED: "false" }, { RUNFENG_CUSTOMER_VEHICLE_UPDATE_ENABLED: "1" }]) assert.equal(customerVehicleEditEnabled(env), false);
  assert.equal(customerVehicleEditEnabled({ RUNFENG_CUSTOMER_VEHICLE_UPDATE_ENABLED: "true" }), true);
});
test("four-field updates reject overposting, blank values, malformed codes and stale-version inputs", () => {
  for (const value of [null, [], {}, { ...input, status: "完成" }, { ...input, vehicle: {} }, { ...input, expectedRevision: "1" },
    { ...input, expectedRevision: -1 }, { ...input, modelLegacyCode: "TEST!" }, { ...input, organizationLegacyCode: "a".repeat(51) },
    ...Object.keys(input).filter(key => key !== "expectedRevision").map(key => ({ ...input, [key]: " " })),
    { ...input, contact: "张\n三" }]) assert.throws(() => parseCustomerVehicleUpdate(value), error => error.status === 400);
  assert.equal(parseCustomerVehicleUpdate({ ...input, contact: " 张三 " }).contact, "张三");
});
test("only active same-shop managers and responsible advisors can update synced linked orders", () => {
  assert.doesNotThrow(() => assertCustomerVehicleEditable(order, actor, 1));
  assert.doesNotThrow(() => assertCustomerVehicleEditable(order, { ...actor, role: "manager", name: "管理员" }, 1));
  for (const patch of [{ role: "technician" }, { role: "inspector" }, { active: false }, { name: "其他顾问" }, { shopId: "other" }]) {
    assert.throws(() => assertCustomerVehicleEditable(order, { ...actor, ...patch }, 1), error => error.status === 403);
  }
  for (const patch of [{ status: "草稿" }, { status: "待客户签字" }, { legacy_sync_status: "failed" }, { legacy_reid: null }, { legacy_document_no: null },
    { dispatch_no: "" }, { legacy_sync_revision: 2 }]) {
    assert.throws(() => assertCustomerVehicleEditable({ ...order, ...patch }, actor, 1), error => error.status === 409);
  }
});
test("pending and processing orders may be edited before their first Runfeng association exists", () => {
  for (const status of ["pending", "processing"]) {
    assert.doesNotThrow(() => assertCustomerVehicleEditable({ ...order, legacy_sync_status: status,
      legacy_reid: null, legacy_document_no: null, dispatch_no: "" }, actor, 1));
  }
});
test("even a stale synced display cannot bypass unfinished outbox events", async () => {
  const calls = [];
  const client = { query: async query => { calls.push(query); return { rows: calls.length === 1 ? [order] : [{}] }; } };
  await assert.rejects(() => lockCustomerVehicleOrder(client, "test-order", actor, 1), /队列状态/);
  assert.match(calls[0], /for update/);
});
test("model and organization names must correspond to real Runfeng codes", () => {
  assert.doesNotThrow(() => assertReferenceMatches({ value: "测试车型" }, "测试车型", "车型"));
  assert.throws(() => assertReferenceMatches(undefined, "测试车型", "车型"), /重新选择或新增/);
  assert.throws(() => assertReferenceMatches({ value: "其他车型" }, "测试车型", "车型"), /不一致/);
});

test("linked imported paper orders support their first correction at revision zero", () => {
  assert.equal(parseCustomerVehicleUpdate({ ...input, expectedRevision: 0 }).expectedRevision, 0);
  assert.doesNotThrow(() => assertCustomerVehicleEditable({ ...order, legacy_sync_revision: 0 }, actor, 0));
  assert.throws(() => assertCustomerVehicleEditable({ ...order, status: "待处理纸质委托书" }, actor, 1), /仅可修改/);
});
