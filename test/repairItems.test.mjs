import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../client/src/features/work-orders/domain/repairItems.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
});
const { filterEmptyRepairItems } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("accidental blank repair rows are removed without changing entered items or IDs", () => {
  const entered = { id: 7, name: "常规保养", laborFee: 0 };
  const rows = [
    { id: 1, name: "", laborFee: 0 },
    entered,
    { id: 8, name: "  ", laborFee: 0 },
    { id: 9, name: "", laborFee: 0 }
  ];
  assert.deepEqual(filterEmptyRepairItems(rows), [entered]);
  assert.equal(rows.length, 4);
});

test("a fee without a project name is retained for required-name validation", () => {
  const incomplete = { id: 1, name: "", laborFee: 100 };
  assert.deepEqual(filterEmptyRepairItems([incomplete]), [incomplete]);
});

test("all blank rows produce an empty list so at least one project remains required", () => {
  assert.deepEqual(filterEmptyRepairItems([{ name: " ", laborFee: 0 }]), []);
});
