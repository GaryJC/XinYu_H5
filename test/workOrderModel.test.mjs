import assert from "node:assert/strict";
import test from "node:test";
import { buildTrend, countBy, createOrderFromDraft, createOrderId, repairActionText, rowToWorkOrder, workOrderValues } from "../server/domain/workOrderModel.mjs";

test("countBy aggregates values without database state", () => {
  const result = countBy(
    [{ status: "维修中" }, { status: "维修中" }, { status: "待结算" }],
    (item) => item.status
  );
  assert.deepEqual(result, { 维修中: 2, 待结算: 1 });
});

test("buildTrend sorts daily work-order counts", () => {
  const result = buildTrend([
    { arrivalDate: "2026-07-10" },
    { arrivalDate: "2026-07-09" },
    { arrivalDate: "2026-07-10" }
  ]);
  assert.deepEqual(result, [
    { label: "2026-07-09", value: 1 },
    { label: "2026-07-10", value: 2 }
  ]);
});

test("repair actions have stable audit labels", () => {
  assert.equal(repairActionText("inspect"), "维修项目检验通过");
  assert.equal(repairActionText("unknown"), "更新维修项目");
});

test("PostgreSQL work-order values preserve the legacy model code", () => {
  const values = workOrderValues({ vehicle: { modelLegacyCode: "DZXPST" } });
  assert.equal(values.length, 37);
  assert.equal(values[17], "DZXPST");
});

test("work order IDs remain unique beyond the former daily 900-value range", () => {
  const ids = Array.from({ length: 1_000 }, () => createOrderId());
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^WT-\d{8}-[0-9A-F]{12}$/.test(id)));
});

test("new work orders ignore client-controlled workflow fields", () => {
  const order = createOrderFromDraft({
    status: "完成",
    technician: "伪造技师",
    inspector: "伪造检验员",
    dispatchNo: "A99999",
    platformOrderNo: "PLAT-forged",
    repairItems: [{ id: 1, name: "测试", status: "已完工", owner: "伪造技师" }],
    signatures: { customer: "伪造签字" }
  });

  assert.equal(order.status, "草稿");
  assert.equal(order.dispatchNo, "");
  assert.equal(order.platformOrderNo, undefined);
  assert.deepEqual(order.signatures, {});
  assert.equal(order.repairItems[0].status, "待派工");
  assert.equal(order.repairItems[0].owner, "待派工");
});


test("military vehicle flag is persisted as a boolean and defaults false for older orders", () => {
  assert.equal(workOrderValues({ vehicle: { isMilitary: true } })[35], true);
  assert.equal(workOrderValues({ vehicle: { isMilitary: false } })[35], false);
  assert.equal(workOrderValues({})[35], false);
  assert.equal(workOrderValues({ vehicle: { isMilitary: "false" } })[35], false);
});


test("reloaded orders retain military selection while historical orders default to civilian", () => {
  const reload = value => rowToWorkOrder({ vehicle_is_military: value }, [], [], [], [], [], [], []);
  assert.equal(reload(true).vehicle.isMilitary, true);
  assert.equal(reload(false).vehicle.isMilitary, false);
  assert.equal(reload(undefined).vehicle.isMilitary, false);
});

test('Baiyuan marker maps and persists strictly without changing order form',()=>{
  assert.equal(workOrderValues({isBaiyuanOrder:true})[36],true);
  assert.equal(workOrderValues({isBaiyuanOrder:'false'})[36],false);
  assert.equal(rowToWorkOrder({is_baiyuan_order:true},[],[],[],[],[],[],[]).isBaiyuanOrder,true);
  assert.equal(rowToWorkOrder({},[],[],[],[],[],[],[]).isBaiyuanOrder,false);
});
