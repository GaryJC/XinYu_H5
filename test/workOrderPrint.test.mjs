import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createOrderFromDraft, rowToWorkOrder } from "../server/domain/workOrderModel.mjs";

const require = createRequire(import.meta.url);
const filename = fileURLToPath(new URL("../client/src/features/work-order-print/WorkOrderPrintDocument.tsx", import.meta.url));
const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS }
}).outputText;
const component = new Module(filename);
component.filename = filename;
component.paths = Module._nodeModulePaths(dirname(filename));
component._compile(compiled, filename);
const { WorkOrderPrintDocument } = component.exports;

function fixture() {
  return { ...createOrderFromDraft({
    vehicle: { plate: "鲁B12345", vin: "LSVAB1234A1234567", mileage: "52380", model: "示例车型" },
    customer: { name: "测试车主", contact: "测试联系人", phone: "13800000000", address: "示例地址" },
    inspection: { belongings: ["行驶证"], fuelLevel: "1/2", exteriorIssues: ["划伤"] },
    repairItems: [{ id: 1, name: "检查制动系统", laborFee: 100 }],
    estimatedFee: 100, faultDescription: "制动异响"
  }), signatures: { customer: "测试车主", reception: "不能出现在打印上的接车签名" } };
}
const render = (order, source) => renderToStaticMarkup(React.createElement(WorkOrderPrintDocument, { order, signatureSource: source }));

test("print template includes saved vehicle data and customer ink, omitting pickup confirmation", () => {
  const html = render(fixture(), "blob:customer-signature");
  for (const value of ["鲁B12345", "LSVAB1234A1234567", "52380", "测试车主", "检查制动系统", "100.00", "blob:customer-signature"]) assert.ok(html.includes(value), value);
  assert.match(html, /alt="客户手写签名"/);
  assert.doesNotMatch(html, /用户接车确认|不能出现在打印上的接车签名/);
});

test("print keeps every repair row beyond the original nine and escapes customer text", () => {
  const order = fixture();
  order.repairItems = Array.from({ length: 30 }, (_, i) => ({ ...order.repairItems[0], id: i + 1, name: `维修项目${i+1}` }));
  order.customer.name = '<script>alert("x")</script>';
  const html = render(order);
  assert.match(html, /维修项目30/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("unsigned orders do not invent a handwritten signature", () => {
  const order = fixture();
  order.signatures = {};
  const html = render(order);
  assert.match(html, /未签字/);
  assert.doesNotMatch(html, /<img/);
});

test("API identifies the customer's linked signature instead of another signer's image", () => {
  const row = { id: "demo", status: "已委托", inspection: {}, created_at: new Date(), updated_at: new Date() };
  const order = rowToWorkOrder(row, [], [
    { signer_type: "inspector", signer_name: "检验员", file_id: "inspector-image" },
    { signer_type: "customer", signer_name: "车主", file_id: "customer-image" }
  ], [], [], [], [], []);
  assert.equal(order.customerSignatureFileId, "customer-image");
});

const printSource = readFileSync(new URL("../client/src/features/work-order-print/printDocument.ts", import.meta.url), "utf8");
const printCode = ts.transpileModule(printSource, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { printDocument } = await import(`data:text/javascript;base64,${Buffer.from(printCode).toString("base64")}`);

function withPrintDom(imageDecode, run) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const events = [];
  const frame = {
    style: {}, setAttribute() {}, remove() { events.push("removed"); },
    contentDocument: {
      createElement: () => ({}), head: { append() {} }, documentElement: {},
      body: { append() {}, getBoundingClientRect() { events.push("layout"); } },
      fonts: { ready: Promise.resolve() }, images: [{ decode: () => imageDecode(events) }]
    },
    contentWindow: { addEventListener() {}, focus() {}, print() { events.push("print"); } }
  };
  globalThis.document = { createElement: () => frame, body: { append() {} } };
  globalThis.window = { setTimeout() {} };
  return Promise.resolve().then(() => run(events)).finally(() => {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  });
}

test("printing waits for signature decoding and layout before opening the dialog", async () => {
  await withPrintDom(async events => { events.push("decoded"); }, async events => {
    await printDocument({ cloneNode: () => ({}) }, "styles", "title");
    assert.deepEqual(events, ["decoded", "layout", "print"]);
  });
});

test("signature decoding failure removes the print frame without printing", async () => {
  await withPrintDom(async () => { throw new Error("image decode failed"); }, async events => {
    await assert.rejects(() => printDocument({ cloneNode: () => ({}) }, "styles", "title"), /image decode failed/);
    assert.deepEqual(events, ["removed"]);
  });
});
