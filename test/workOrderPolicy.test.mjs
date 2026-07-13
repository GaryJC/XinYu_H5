import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDraftEditable,
  assertPlatformSyncAllowed,
  assertRepairItemAction,
  assertSettlementAllowed,
  assertStatusTransition
} from "../server/domain/workOrderPolicy.mjs";
import { HttpError } from "../server/http/HttpError.mjs";

test("work-order state changes must follow the workflow", () => {
  assert.doesNotThrow(() => assertStatusTransition("已委托", "待派工"));
  assert.doesNotThrow(() => assertStatusTransition("待结算", "完成"));
  assert.throws(
    () => assertStatusTransition("草稿", "完成"),
    (error) => error instanceof HttpError && error.status === 409
  );
});

test("signed work orders cannot be edited as drafts", () => {
  assert.doesNotThrow(() => assertDraftEditable("草稿"));
  assert.throws(() => assertDraftEditable("已委托"), (error) => error.status === 409);
});

test("repair-item actions reject missing items, unknown actions, and wrong states", () => {
  assert.doesNotThrow(() => assertRepairItemAction({ status: "待领料" }, "pick"));
  assert.throws(() => assertRepairItemAction(undefined, "pick"), (error) => error.status === 404);
  assert.throws(() => assertRepairItemAction({ status: "待领料" }, "remove"), (error) => error.status === 400);
  assert.throws(() => assertRepairItemAction({ status: "待派工" }, "start"), (error) => error.status === 409);
});

test("settlement and platform sync enforce their prerequisites", () => {
  assert.doesNotThrow(() => assertSettlementAllowed("待结算"));
  assert.throws(() => assertSettlementAllowed("草稿"), (error) => error.status === 409);
  assert.throws(() => assertPlatformSyncAllowed({ status: "待客户签字" }), (error) => error.status === 409);
  assert.throws(
    () => assertPlatformSyncAllowed({ status: "已委托", platformOrderNo: "PLAT-1" }),
    (error) => error.status === 409
  );
});
