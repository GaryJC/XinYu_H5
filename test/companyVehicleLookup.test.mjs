import assert from "node:assert/strict";
import test from "node:test";
import {
  lookupVehicleInCompanySystem,
  normalizeReference,
  resolveReference,
  resolveVehicleCandidates
} from "../server/integrations/company/vehicleLookup.mjs";
import { HttpError } from "../server/http/HttpError.mjs";

test("company vehicle lookup matches a saved vehicle by plate", async () => {
  const result = await lookupVehicleInCompanySystem({ plate: " 辽-A12345 " });
  assert.equal(result.found, true);
  assert.equal(result.status, "found");
  assert.equal(result.vehicle.vin, "LSVNV2182E2123456");
  assert.equal(result.vehicle.model, "大众 帕萨特 2023款");
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
  assert.equal(result.references.organization.status, "matched");
  assert.equal(result.references.organization.selected.code, "QDDTGSYXYYFGS");
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

test("company vehicle lookup rejects an empty identifier", async () => {
  await assert.rejects(
    () => lookupVehicleInCompanySystem({}),
    (error) => error instanceof HttpError && error.status === 400
  );
});
