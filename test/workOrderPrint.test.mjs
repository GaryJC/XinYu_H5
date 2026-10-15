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
const render = (order, source, arrivalDate) => renderToStaticMarkup(React.createElement(WorkOrderPrintDocument, { order, signatureSource: source, arrivalDate }));

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
const { printDocument, preparePrintDocument, singlePageScale } = await import(`data:text/javascript;base64,${Buffer.from(printCode).toString("base64")}`);

function withPrintDom(imageDecode, run) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const events = [];
  const frame = {
    style: {}, setAttribute() {}, remove() { events.push("removed"); },
    contentDocument: {
      createElement: () => ({ style: {}, append() {} }), head: { append() {} }, documentElement: {},
      body: { append() {}, getBoundingClientRect() { events.push("layout"); } },
      fonts: { ready: Promise.resolve() }, images: [{ decode: () => imageDecode(events) }]
    },
    contentWindow: { addEventListener() {}, focus() {}, print() { events.push("print"); } }
  };
  globalThis.document = { createElement: () => frame, body: { append() {} } };
  globalThis.window = { setTimeout() {} };
  return Promise.resolve().then(() => run(events, frame)).finally(() => {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  });
}

test("printing waits for signature decoding and layout before opening the dialog", async () => {
  await withPrintDom(async events => { events.push("decoded"); }, async events => {
    await printDocument({ cloneNode: () => ({style:{},scrollHeight:900,getBoundingClientRect:()=>({height:900})}) }, "styles", "title");
    assert.deepEqual(events, ["decoded", "layout", "print"]);
  });
});

test("signature decoding failure removes the print frame without printing", async () => {
  await withPrintDom(async () => { throw new Error("image decode failed"); }, async events => {
    await assert.rejects(() => printDocument({ cloneNode: () => ({style:{},scrollHeight:900,getBoundingClientRect:()=>({height:900})}) }, "styles", "title"), /image decode failed/);
    assert.deepEqual(events, ["removed"]);
  });
});

test("print removes marked content and the work-time column, leaving zero labor fees blank", () => {
  const order = fixture();
  order.repairItems[0].laborFee = 0;
  order.repairItems[0].startAt = "start-must-not-print";
  order.feeNote = "fee-note-must-not-print";
  const html = render(order);
  for (const removed of [order.id, "开工 / 完工时间", "start-must-not-print", "fee-note-must-not-print", "旧件：", "含检查费", "费用备注"]) assert.ok(!html.includes(removed), removed);
  assert.match(html, /检查制动系统<\/td><td><\/td>/);
});

test("printing can override the arrival date without modifying the stored order", () => {
  const order = fixture();
  order.arrivalDate = "2026-09-14";
  const html = render(order, undefined, "2026-10-15");
  assert.match(html, /进厂日期：2026-10-15/);
  assert.ok(!html.includes("2026-09-14"));
  assert.equal(order.arrivalDate, "2026-09-14");
});

test("single-page fitting preserves all content within one A4 page", () => {
  for (const height of [500, 1000, 2000, 5000]) {
    const scale = singlePageScale(height);
    assert.ok(scale > 0 && scale <= 1);
    assert.ok(height * scale <= 276 * 96 / 25.4 + 0.01);
  }
  assert.throws(() => singlePageScale(0), /无法计算/);
});

test("PDF preparation works without a native print API", async () => {
  await withPrintDom(async events => { events.push("decoded"); }, async (events, frame) => {
    frame.contentWindow.print = undefined;
    const prepared = await preparePrintDocument({ cloneNode: () => ({ style: {}, scrollHeight: 900, getBoundingClientRect: () => ({ height: 900 }) }) }, "styles", "title");
    assert.equal(prepared.frame, frame);
    assert.deepEqual(events, ["decoded", "layout"]);
    prepared.frame.remove();
    await assert.rejects(() => printDocument({ cloneNode: () => ({ style: {}, scrollHeight: 900, getBoundingClientRect: () => ({ height: 900 }) }) }, "styles", "title"), /请选择导出 PDF|请选择导出|选择导出 PDF/);
  });
});


test("printing waits for both document font weights before signature decoding and layout", async () => {
  await withPrintDom(async events => { events.push("decoded"); }, async (events, frame) => {
    frame.contentDocument.fonts.load = async (font, text) => {
      events.push(font.startsWith("400") ? "regular font" : "bold font");
      assert.ok(text.includes("委托书"));
      await Promise.resolve();
    };
    const paper = {
      style: {}, textContent: "机动车修理委托书 测试车主",
      querySelectorAll: () => [{ textContent: "机动车修理委托书" }],
      scrollHeight: 900, getBoundingClientRect: () => ({ height: 900 })
    };
    await printDocument({ cloneNode: () => paper }, "styles", "title");
    assert.deepEqual(events, ["regular font", "bold font", "decoded", "layout", "print"]);
  });
});

test("font loading failure prevents an export with substituted fonts", async () => {
  await withPrintDom(async events => { events.push("decoded"); }, async (events, frame) => {
    frame.contentDocument.fonts.load = async () => { throw new Error("font unavailable"); };
    const paper = { style: {}, textContent: "委托书", querySelectorAll: () => [] };
    await assert.rejects(() => preparePrintDocument({ cloneNode: () => paper }, "styles", "title"), /font unavailable/);
    assert.deepEqual(events, ["removed"]);
  });
});
