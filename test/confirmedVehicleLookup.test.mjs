import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync(new URL("../client/src/features/vehicle-identity/useVehicleIdentityRecognition.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, require: () => ({}) });
const { applyVehicleLookup } = exports;
const draft = { vehicle: { plate: "鲁B12345", vin: "VIN", model: "员工确认车型", modelLegacyCode: "NEW" },
  customer: { name: "员工确认单位", legacyCode: "neworg", contact: "员工确认联系人", phone: "13000000001" } };
const history = { found: true, vehicle: { plate: "鲁B12345", vin: "VIN", model: "历史车型", modelLegacyCode: "OLD", organization: { name: "历史单位", code: "oldorg" } } };

test("existing-plate lookup preserves confirmed model, organization and contact for new orders", () => {
  const result = applyVehicleLookup(draft, history);
  assert.deepEqual(JSON.parse(JSON.stringify(result.vehicle)), draft.vehicle);
  assert.deepEqual(result.customer, draft.customer);
});
test("existing-plate lookup supplies defaults when no model or organization has been confirmed", () => {
  const result = applyVehicleLookup({ vehicle: { plate: "鲁B12345" }, customer: { contact: "送修人", phone: "13000000001" } }, history);
  assert.equal(result.vehicle.model, "历史车型"); assert.equal(result.vehicle.modelLegacyCode, "OLD");
  assert.equal(result.customer.name, "历史单位"); assert.equal(result.customer.legacyCode, "oldorg");
  assert.equal(result.customer.contact, "送修人"); assert.equal(result.customer.phone, "13000000001");
});
