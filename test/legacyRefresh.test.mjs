import test from "node:test";
import assert from "node:assert/strict";
import { buildLegacyRefresh, legacyDate } from "../server/domain/legacyRefresh.mjs";
import { readLegacyWorkOrder, LEGACY_ITEMS_QUERY, LEGACY_ORDER_QUERY } from "../server/repositories/legacyWorkOrderRepository.mjs";

function snapshot() {
  return { header: { reid: 101, dh: 201, wd: "", pgd: "A123", ch: "鲁B12345", jcrq: "20261015", jhrq: "2026/10/16", fyhj: 120, wxnr: "制动异响" },
    vehicle: { sbdm: "LSVAB1234A1234567", model_name: "测试车型", model_code: "TEST" },
    customer: { mc: "测试车主", jydz: "测试地址" }, items: [{ reid: 301, hh: "检查制动", je: 120 }] };
}
const item = { id: 10, client_item_id: 7, name: "检查制动", status: "维修中", start_at: "2026-10-15 10:00" };

test("legacy dates normalize Runfeng formats and reject invalid calendar dates", () => {
  for (const source of ["20261015", "2026-10-15", "2026/10/15", "2026.10.15"]) assert.equal(legacyDate(source), "2026-10-15");
  assert.equal(legacyDate(""), "");
  for (const source of ["20260230", "20261301", "bad"]) assert.throws(() => legacyDate(source), /日期/);
});
test("initial unique-name matching preserves local project identity and progress", () => {
  const result = buildLegacyRefresh(snapshot(), [item], true);
  assert.equal(result.items[0].clientId, 7);
  assert.equal(result.items[0].existing.start_at, item.start_at);
  assert.equal(result.fields.arrival_date, "2026-10-15");
  assert.equal(result.fields.estimated_fee, 120);
  for (const protectedField of ["status", "advisor", "shop_id", "signatures", "inspection", "settlement_amount"]) assert.ok(!(protectedField in result.fields));
});
test("stable source ids allow later rename and reorder without losing execution history", () => {
  const source = snapshot(); source.items[0].hh = "调整后的维修名称";
  const result = buildLegacyRefresh(source, [{ ...item, legacy_item_reid: 301 }], true);
  assert.equal(result.items[0].clientId, 7);
  assert.equal(result.items[0].name, "调整后的维修名称");
});
test("active jobs reject added, removed and ambiguous initial project matches", () => {
  const source = snapshot(); source.items.push({ reid: 302, hh: "新增维修", je: 0 });
  assert.throws(() => buildLegacyRefresh(source, [item], true), /已有派工/);
  const empty = snapshot(); empty.items = [];
  assert.throws(() => buildLegacyRefresh(empty, [item], true), /已有派工/);
  const duplicate = snapshot(); duplicate.items.push({ reid: 302, hh: "检查制动", je: 0 });
  assert.throws(() => buildLegacyRefresh(duplicate, [item], true), /已有派工/);
});
test("unassigned orders can replace their complete item list including genuine zero fees", () => {
  const source = snapshot(); source.items = [{ reid: 302, hh: "新增维修", je: 0 }];
  const result = buildLegacyRefresh(source, [item], false);
  assert.equal(result.removed[0].id, 10);
  assert.equal(result.items[0].laborFee, 0);
  assert.equal(result.items[0].clientId, 8);
});
test("malformed source values and duplicate identities abort the whole change", () => {
  for (const fee of [-1, "NaN", Infinity]) {
    const source = snapshot(); source.items[0].je = fee;
    assert.throws(() => buildLegacyRefresh(source, [item], false), /金额/);
  }
  const source = snapshot(); source.items.push({ ...source.items[0] });
  assert.throws(() => buildLegacyRefresh(source, [item], false), /标识/);
});
test("Runfeng query uses exact stored identity, includes branch in details, excludes materials", async () => {
  const queries = [];
  const source = snapshot();
  const result = await readLegacyWorkOrder({ id: "WT-20261015-TEST", legacy_reid: 101, legacy_document_no: 201 }, async run => run(async (query, configure) => {
    const inputs = {};
    const request = { input: (key, _type, value) => { inputs[key] = value; } };
    const sql = new Proxy({}, { get: () => () => "type" });
    configure?.(request, sql);
    queries.push({ query, inputs });
    if (query === LEGACY_ORDER_QUERY) return { recordset: [{ ...source.header, bzxx: "H5:WT-20261015-TEST" }] };
    if (query === LEGACY_ITEMS_QUERY) return { recordset: source.items };
    return { recordset: [] };
  }));
  assert.equal(result.header.reid, 101);
  assert.equal(queries[0].inputs.reid, 101);
  assert.equal(queries[0].inputs.dh, 201);
  assert.match(queries[1].query, /wd=@wd/);
  assert.match(queries[1].query, /RTRIM\(lb\)='项目'/);
  assert.doesNotMatch(queries[0].query, /plate|ch=@/);
});
test("missing, duplicate or mismatched source records never fall back to a different vehicle order", async () => {
  for (const rows of [[], [{ reid: 1 }, { reid: 2 }], [{ bzxx: "H5:other" }]]) {
    let reads = 0;
    await assert.rejects(() => readLegacyWorkOrder({ id: "WT-test", legacy_reid: 1, legacy_document_no: 2 },
      async run => run(async () => { reads++; return { recordset: rows }; })), /润丰/);
    assert.equal(reads, 1);
  }
});
