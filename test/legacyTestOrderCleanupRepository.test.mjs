import assert from "node:assert/strict";
import test from "node:test";
import {
  DELETE_LEGACY_TEST_ORDER_ITEMS_QUERY,
  DELETE_LEGACY_TEST_ORDER_QUERY,
  FIND_LEGACY_TEST_ORDER_QUERY,
  assertNoDownstreamRecords,
  deleteLegacyTestOrder,
  inspectLegacyTestOrder
} from "../server/repositories/legacyTestOrderCleanupRepository.mjs";

const sqlTypes = new Proxy({}, {
  get(_target, name) {
    return (...args) => ({ name: String(name), args });
  }
});

const legacyRow = {
  reid: 1029600,
  dh: 85995,
  pgd: "A66659",
  ch: "鲁BTEST01",
  bzxx: "H5:WT-20260817-ABC123DEF456",
  repair_item_count: 2,
  assignment_count: 0,
  outbound_count: 0,
  completion_count: 0,
  return_count: 0,
  payment_count: 0,
  archive_count: 0
};

test("cleanup inspection only matches the exact H5 source marker", async () => {
  let call;
  const result = await inspectLegacyTestOrder("WT-20260817-ABC123DEF456", {
    executeQuery: async (query, configure) => {
      call = { query, inputs: collectInputs(configure) };
      return { recordset: [legacyRow] };
    }
  });

  assert.equal(call.query, FIND_LEGACY_TEST_ORDER_QUERY);
  assert.equal(call.inputs.source_marker, "H5:WT-20260817-ABC123DEF456");
  assert.equal(result.dispatchNo, "A66659");
  assert.equal(result.repairItemCount, 2);
});

test("cleanup refuses orders that already produced downstream business records", () => {
  assert.throws(
    () => assertNoDownstreamRecords({ ...legacyRow, dispatchNo: "A66659", outbound_count: 1 }),
    /出库单 1 条.*禁止自动删除/
  );
});

test("cleanup deletes project lines before the exact marked Runfeng header", async () => {
  const calls = [];
  const result = await deleteLegacyTestOrder("WT-20260817-ABC123DEF456", {
    executeTransaction: async (work) => work(async (query, configure) => {
      const call = { query, inputs: collectInputs(configure) };
      calls.push(call);
      if (query === FIND_LEGACY_TEST_ORDER_QUERY) return { recordset: [legacyRow] };
      if (query === DELETE_LEGACY_TEST_ORDER_ITEMS_QUERY) return { rowsAffected: [2] };
      if (query === DELETE_LEGACY_TEST_ORDER_QUERY) return { rowsAffected: [1] };
      throw new Error("unexpected query");
    })
  });

  assert.equal(result.deleted, true);
  assert.deepEqual(calls.map((call) => call.query), [
    FIND_LEGACY_TEST_ORDER_QUERY,
    DELETE_LEGACY_TEST_ORDER_ITEMS_QUERY,
    DELETE_LEGACY_TEST_ORDER_QUERY
  ]);
  assert.equal(calls[1].inputs.document_no, 85995);
  assert.equal(calls[2].inputs.legacy_reid, 1029600);
  assert.equal(calls[2].inputs.source_marker, "H5:WT-20260817-ABC123DEF456");
});

test("cleanup rolls back when project line count changes", async () => {
  await assert.rejects(
    () => deleteLegacyTestOrder("WT-20260817-ABC123DEF456", {
      executeTransaction: async (work) => work(async (query) => {
        if (query === FIND_LEGACY_TEST_ORDER_QUERY) return { recordset: [legacyRow] };
        return { rowsAffected: [1] };
      })
    }),
    /维修项目数量在清理期间发生变化/
  );
});

test("cleanup rejects arbitrary identifiers", async () => {
  await assert.rejects(
    () => inspectLegacyTestOrder("A66659", { executeQuery: async () => ({ recordset: [] }) }),
    /委托单号格式无效/
  );
});

function collectInputs(configure) {
  const inputs = {};
  configure?.({
    input(name, _type, value) {
      inputs[name] = value;
    }
  }, sqlTypes);
  return inputs;
}
