import assert from "node:assert/strict";
import test from "node:test";
import { buildTrend, countBy, repairActionText } from "../server/domain/workOrderModel.mjs";

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
