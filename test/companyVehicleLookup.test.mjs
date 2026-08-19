import assert from "node:assert/strict";
import test from "node:test";
import {
  checkCompanyVehicleReferenceCode,
  createCompanyVehicleReference,
  lookupVehicleInCompanySystem,
  normalizeNewReferenceCode,
  normalizeReference,
  resolveReference,
  resolveVehicleCandidates,
  searchCompanyVehicleReferences
} from "../server/integrations/company/vehicleLookup.mjs";
import { HttpError } from "../server/http/HttpError.mjs";

test("company vehicle lookup matches a saved vehicle by plate", async () => {
  const result = await lookupVehicleInCompanySystem({ plate: " 辽-A12345 " });
  assert.equal(result.found, true);
  assert.equal(result.status, "found");
  assert.equal(result.vehicle.vin, "LSVNV2182E2123456");
  assert.equal(result.vehicle.model, "大众 帕萨特 2023款");
  assert.equal(result.vehicle.modelLegacyCode, "DZPST");
  assert.deepEqual(result.vehicle.organization, { code: "GR", name: "个人" });
});

test("company vehicle lookup matches a saved vehicle by VIN", async () => {
  const result = await lookupVehicleInCompanySystem({ vin: "lsvcy6c49mn027789" });
  assert.equal(result.found, true);
  assert.equal(result.vehicle.plate, "沪AG12345");
});

test("company vehicle lookup returns a clean miss for a new vehicle", async () => {
  const result = await lookupVehicleInCompanySystem({ plate: "辽B00001" });
  assert.deepEqual(result, {
    found: false,
    status: "new",
    message: "公司系统中未查询到这辆车，可继续新建车辆档案"
  });
});

test("company vehicle lookup reuses normalized model and organization for a new vehicle", async () => {
  const result = await lookupVehicleInCompanySystem({
    plate: "辽B00001",
    vin: "NEWVIN00000000001",
    model: "奥迪-A6",
    owner: " 青岛地铁运营有限公司 "
  });

  assert.equal(result.status, "new");
  assert.equal(result.references.model.status, "matched");
  assert.equal(result.references.model.selected.value, "奥迪 A6");
  assert.equal(result.references.model.selected.code, "ADA6");
  assert.equal(result.references.organization.status, "matched");
  assert.equal(result.references.organization.selected.code, "QDDTGSYXYYFGS");
});

test("fuzzy model and organization matches are returned for manual selection", async () => {
  const result = await lookupVehicleInCompanySystem({
    plate: "辽B00002",
    model: "大众",
    owner: "水务公司"
  });

  assert.equal(result.status, "new");
  assert.equal(result.references.model.status, "ambiguous");
  assert.deepEqual(result.references.model.candidates.map((item) => item.value), [
    "大众 帕萨特 2023款",
    "大众汽车 SVW7142BPV"
  ]);
  assert.deepEqual(result.references.model.candidates.map((item) => item.code), ["DZPST", "DZ"]);
  assert.equal(result.references.organization.status, "ambiguous");
  assert.deepEqual(result.references.organization.candidates.map((item) => item.code), ["QDSWJT", "QDSWFZ"]);
  assert.match(result.message, /请选择/);
});

test("a single fuzzy candidate still requires manual confirmation", () => {
  const result = resolveReference("大众", [
    { value: "大众 帕萨特 2023款", usageCount: 12 }
  ], false);
  assert.equal(result.status, "ambiguous");
});

test("autocomplete searches fuzzy vehicle references", async () => {
  const models = await searchCompanyVehicleReferences({ kind: "model", query: "大众" });
  const organizations = await searchCompanyVehicleReferences({ kind: "organization", query: "水务公司" });

  assert.equal(models.candidates.length, 2);
  assert.deepEqual(organizations.candidates.map((item) => item.code), ["QDSWJT", "QDSWFZ"]);
  assert.deepEqual(await searchCompanyVehicleReferences({ kind: "model", query: "大" }), {
    kind: "model",
    query: "大",
    candidates: []
  });
});

test("reference code check detects existing codes and accepts unused codes", async () => {
  assert.deepEqual(await checkCompanyVehicleReferenceCode({ kind: "model", code: " ADA6 " }), {
    kind: "model",
    code: "ADA6",
    available: false,
    existing: { value: "奥迪 A6", code: "ADA6", usageCount: 8 }
  });
  assert.deepEqual(await checkCompanyVehicleReferenceCode({ kind: "organization", code: "qdxkh" }), {
    kind: "organization",
    code: "qdxkh",
    available: true
  });
});

test("creating a reference validates input and rejects a conflicting SQL Server code", async () => {
  const created = await createCompanyVehicleReference({
    kind: "model",
    name: " 大众新帕萨特 ",
    code: " dzxpst "
  }, async (input) => ({ value: input.name, code: input.code, usageCount: 0, created: true }));
  assert.deepEqual(created, {
    kind: "model",
    value: "大众新帕萨特",
    code: "dzxpst",
    usageCount: 0,
    created: true
  });

  await assert.rejects(
    () => createCompanyVehicleReference({ kind: "organization", name: "新单位", code: "qdsw" }, async () => ({
      value: "已有单位",
      code: "qdsw",
      usageCount: 0,
      created: false
    })),
    (error) => error instanceof HttpError && error.status === 409 && /已有单位/.test(error.message)
  );
});

test("new reference codes preserve conventional case and respect legacy lengths", () => {
  assert.equal(normalizeNewReferenceCode(" grqdswjty ", 50), "grqdswjty");
  assert.throws(() => normalizeNewReferenceCode("DZ-XPST", 10), /只能包含英文字母和数字/);
  assert.throws(() => normalizeNewReferenceCode("ABCDEFGHIJK", 10), /最多 10 个字符/);
});

test("vehicle lookup refuses to merge conflicting plate and VIN matches", () => {
  const result = resolveVehicleCandidates([
    { id: "plate-row", plate: "辽A12345", vin: "VIN1", plateMatched: true, vinMatched: false },
    { id: "vin-row", plate: "辽B12345", vin: "VIN2", plateMatched: false, vinMatched: true }
  ], "辽A12345", "VIN2");

  assert.equal(result.status, "conflict");
  assert.deepEqual(result.conflicts.map((item) => item.identifier), ["plate", "vin"]);
});

test("organization matching requires a unique bm code", () => {
  const result = resolveReference("个人", [
    { value: "个人", code: "gr", usageCount: 20 },
    { value: "个人", code: "r", usageCount: 5 }
  ], true);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.candidates.length, 2);
  assert.equal(normalizeReference(" Audi-A6 "), "AUDIA6");
});

test("model matching requires a unique cxb bh code", () => {
  const result = resolveReference("测试车型", [
    { value: "测试车型", code: "CSCX1", usageCount: 20 },
    { value: "测试车型", code: "CSCX2", usageCount: 5 }
  ], true);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.candidates.length, 2);
});

test("company vehicle lookup rejects an empty identifier", async () => {
  await assert.rejects(
    () => lookupVehicleInCompanySystem({}),
    (error) => error instanceof HttpError && error.status === 400
  );
});
