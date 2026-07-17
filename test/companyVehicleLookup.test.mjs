import assert from "node:assert/strict";
import test from "node:test";
import { lookupVehicleInCompanySystem } from "../server/integrations/company/vehicleLookup.mjs";
import { HttpError } from "../server/http/HttpError.mjs";

test("company vehicle lookup matches a saved vehicle by plate", async () => {
  const result = await lookupVehicleInCompanySystem({ plate: " 辽-A12345 " });
  assert.equal(result.found, true);
  assert.equal(result.vehicle.vin, "LSVNV2182E2123456");
  assert.equal(result.vehicle.model, "大众 帕萨特 2023款");
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
    message: "公司系统中未查询到这辆车，可继续新建车辆档案"
  });
});

test("company vehicle lookup rejects an empty identifier", async () => {
  await assert.rejects(
    () => lookupVehicleInCompanySystem({}),
    (error) => error instanceof HttpError && error.status === 400
  );
});
