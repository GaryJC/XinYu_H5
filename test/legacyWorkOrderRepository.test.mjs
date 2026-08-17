import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOCATE_LEGACY_WORK_ORDER_NUMBERS_QUERY,
  FIND_LEGACY_VEHICLE_FOR_WRITE_QUERY,
  FIND_LEGACY_WORK_ORDER_BY_SOURCE_QUERY,
  INSERT_LEGACY_REPAIR_ITEM_QUERY,
  INSERT_LEGACY_VEHICLE_QUERY,
  INSERT_LEGACY_WORK_ORDER_QUERY,
  formatLegacyDate,
  truncateLegacyText,
  writeLegacyWorkOrder
} from "../server/repositories/legacyWorkOrderRepository.mjs";

const sqlTypes = new Proxy({}, {
  get(_target, name) {
    return (...args) => ({ name: String(name), args });
  }
});

const order = {
  id: "WT-20260817-ABC123",
  arrivalDate: "2026-08-17",
  advisor: "张三",
  department: { code: "A", name: "机电一部" },
  vehicle: {
    plate: "鲁B5P226",
    vin: "LSVCH2A47CN165407",
    mileage: "12345",
    model: "大众-帕萨特",
    modelLegacyCode: "DZPST",
    purchaseDate: "2022-01-03"
  },
  customer: {
    name: "青岛水务集团有限公司",
    legacyCode: "grqdswjty",
    contact: "李经理",
    phone: "13800000000",
    address: "青岛市"
  },
  faultDescription: "客户要求检查车辆",
  repairItems: [
    { name: "检查发动机", laborFee: 80 },
    { name: "更换机油", laborFee: 20 }
  ]
};

test("legacy dates use Runfeng YYYY.MM.DD format and reject invalid input", () => {
  assert.equal(formatLegacyDate("2026-08-17"), "2026.08.17");
  assert.equal(formatLegacyDate("2026/8/7"), "2026.08.07");
  assert.throws(() => formatLegacyDate("2026-02-30"), /日期无效/);
  assert.throws(() => formatLegacyDate("17-08-2026"), /YYYY-MM-DD/);
});

test("legacy text truncation respects the old database byte budget", () => {
  assert.equal(truncateLegacyText("AB中文CD", 6), "AB中文");
  assert.equal(truncateLegacyText("  鲁B5P226  ", 10), "鲁B5P226");
});

test("direct write is idempotent for an existing H5 source marker", async () => {
  const calls = [];
  const result = await writeLegacyWorkOrder(order, {
    executeTransaction: async (work) => work(async (query, configure) => {
      const inputs = collectInputs(configure);
      calls.push({ query, inputs });
      return { recordset: [{ reid: 1029600, dh: 85995, pgd: "A66659" }] };
    })
  });

  assert.deepEqual(result, {
    reid: 1029600,
    documentNo: 85995,
    dispatchNo: "A66659",
    existing: true
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].query, FIND_LEGACY_WORK_ORDER_BY_SOURCE_QUERY);
  assert.equal(calls[0].inputs.source_marker, `H5:${order.id}`);
});

test("direct write allocates both numbers under a table lock and inserts header, vehicle and project lines", async () => {
  const calls = [];
  const responses = new Map([
    [FIND_LEGACY_WORK_ORDER_BY_SOURCE_QUERY, { recordset: [] }],
    [ALLOCATE_LEGACY_WORK_ORDER_NUMBERS_QUERY, { recordset: [{ max_document_no: 85994, max_dispatch_number: 66658 }] }],
    [FIND_LEGACY_VEHICLE_FOR_WRITE_QUERY, { recordset: [] }],
    [INSERT_LEGACY_VEHICLE_QUERY, { recordset: [] }],
    [INSERT_LEGACY_WORK_ORDER_QUERY, { recordset: [{ reid: 1029598 }] }],
    [INSERT_LEGACY_REPAIR_ITEM_QUERY, { recordset: [] }]
  ]);

  const result = await writeLegacyWorkOrder(order, {
    now: new Date(2026, 7, 17, 14, 6),
    executeTransaction: async (work) => work(async (query, configure) => {
      const inputs = collectInputs(configure);
      calls.push({ query, inputs });
      return responses.get(query);
    })
  });

  assert.match(ALLOCATE_LEGACY_WORK_ORDER_NUMBERS_QUERY, /tablockx, holdlock/i);
  assert.deepEqual(result, {
    reid: 1029598,
    documentNo: 85995,
    dispatchNo: "A66659",
    existing: false
  });
  assert.equal(calls.filter((call) => call.query === INSERT_LEGACY_REPAIR_ITEM_QUERY).length, 2);

  const vehicleInsert = calls.find((call) => call.query === INSERT_LEGACY_VEHICLE_QUERY);
  assert.equal(vehicleInsert.inputs.model_text, "DZPST 大众-帕萨特");
  assert.equal(vehicleInsert.inputs.organization_code, "grqdswjty");
  assert.equal(vehicleInsert.inputs.production_date, "2022.01.03");

  const headerInsert = calls.find((call) => call.query === INSERT_LEGACY_WORK_ORDER_QUERY);
  assert.equal(headerInsert.inputs.document_no, 85995);
  assert.equal(headerInsert.inputs.dispatch_no, "A66659");
  assert.equal(headerInsert.inputs.arrival_date, "2026.08.17");
  assert.equal(headerInsert.inputs.arrival_time, "14:06");
  assert.equal(headerInsert.inputs.project_fee, 100);
  assert.equal(headerInsert.inputs.organization_code, "grqdswjty");
  assert.equal(headerInsert.inputs.source_marker, `H5:${order.id}`);
});

test("an existing vehicle keeps its stored model and organization codes", async () => {
  const calls = [];
  const responses = new Map([
    [FIND_LEGACY_WORK_ORDER_BY_SOURCE_QUERY, { recordset: [] }],
    [ALLOCATE_LEGACY_WORK_ORDER_NUMBERS_QUERY, { recordset: [{ max_document_no: 9, max_dispatch_number: 19 }] }],
    [FIND_LEGACY_VEHICLE_FOR_WRITE_QUERY, { recordset: [{ reid: 12, cx: "OLD 现有车型", ssdw: "existing-code", plate_matched: 1 }] }],
    [INSERT_LEGACY_WORK_ORDER_QUERY, { recordset: [{ reid: 20 }] }],
    [INSERT_LEGACY_REPAIR_ITEM_QUERY, { recordset: [] }]
  ]);

  await writeLegacyWorkOrder(order, {
    executeTransaction: async (work) => work(async (query, configure) => {
      calls.push({ query, inputs: collectInputs(configure) });
      return responses.get(query);
    })
  });

  assert.equal(calls.some((call) => call.query === INSERT_LEGACY_VEHICLE_QUERY), false);
  const headerInsert = calls.find((call) => call.query === INSERT_LEGACY_WORK_ORDER_QUERY);
  assert.equal(headerInsert.inputs.model_text, "OLD 现有车型");
  assert.equal(headerInsert.inputs.organization_code, "existing-code");
});

test("direct write stops when plate and VIN point to different legacy vehicles", async () => {
  const responses = new Map([
    [FIND_LEGACY_WORK_ORDER_BY_SOURCE_QUERY, { recordset: [] }],
    [ALLOCATE_LEGACY_WORK_ORDER_NUMBERS_QUERY, { recordset: [{ max_document_no: 9, max_dispatch_number: 19 }] }],
    [FIND_LEGACY_VEHICLE_FOR_WRITE_QUERY, { recordset: [
      { reid: 12, cx: "车型一", ssdw: "one", plate_matched: 1 },
      { reid: 13, cx: "车型二", ssdw: "two", plate_matched: 0 }
    ] }]
  ]);

  await assert.rejects(
    () => writeLegacyWorkOrder(order, {
      executeTransaction: async (work) => work(async (query, configure) => {
        collectInputs(configure);
        return responses.get(query);
      })
    }),
    /车牌号和 VIN 指向润丰中的不同车辆/
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
