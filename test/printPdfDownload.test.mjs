import assert from "node:assert/strict";
import test from "node:test";
process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
const { createPrintPdfStore, preparePrintPdf } = await import("../server/services/printPdfService.mjs");
const { handlePrintPdfDownload } = await import("../server/routes/printPdfRouter.mjs");
const { pool } = await import("../server/database/pool.mjs");

const input = (userId = "advisor") => ({ userId, fileName: "机动车修理委托书.pdf", pdfBase64: Buffer.from("%PDF-1.7\nexample").toString("base64") });
const tokenOf = result => result.path.split("/").at(-1).replace(".pdf", "");

test("native PDF handoff expires and invalidates the user's previous file", () => {
  let now = 0;
  const store = createPrintPdfStore({ now: () => now, ttl: 1000 });
  try {
    const first = store.put(input());
    const second = store.put(input());
    assert.match(tokenOf(second), /^[a-f0-9]{64}$/);
    assert.throws(() => store.get(tokenOf(first)), { status: 404 });
    assert.equal(store.get(tokenOf(second)).body.toString(), "%PDF-1.7\nexample");
    now = 1000;
    assert.throws(() => store.get(tokenOf(second)), { status: 404 });
  } finally { store.close(); }
});

test("handoff rejects non-PDF data and limits memory without evicting other users", () => {
  const store = createPrintPdfStore({ maxBytes: 25 });
  try {
    assert.throws(() => store.put({ ...input(), pdfBase64: "data:application/pdf;base64,aaa" }), { status: 400 });
    assert.throws(() => store.put({ ...input(), pdfBase64: Buffer.from("<html>evil</html>").toString("base64") }), { status: 400 });
    const first = store.put(input());
    assert.throws(() => store.put(input("other-user")), { status: 503 });
    assert.ok(store.get(tokenOf(first)));
  } finally { store.close(); }
});

test("PDF creation enforces order access and native downloads return the PDF without session headers", async t => {
  t.mock.method(pool, "query", async () => ({ rows: [{ advisor: "张三", shop_id: "shop-hq" }] }));
  const user = { id: "advisor", role: "advisor", name: "张三", shopId: "shop-hq" };
  await assert.rejects(() => preparePrintPdf("order", input(), { ...user, shopId: "other" }), { status: 403 });
  await assert.rejects(() => preparePrintPdf("order", input(), { ...user, name: "其他顾问" }), { status: 403 });
  const file = await preparePrintPdf("order", input(), user);
  const headers = {};
  let body;
  const res = { setHeader: (key, value) => { headers[key] = value; }, end: value => { body = value; } };
  assert.equal(handlePrintPdfDownload({ method: "GET" }, res, new URL(file.path, "https://example.test")), true);
  assert.equal(body.toString(), "%PDF-1.7\nexample");
  assert.equal(headers["Content-Type"], "application/pdf");
  assert.equal(headers["Cache-Control"], "private, no-store");
  assert.ok(headers["Content-Disposition"].includes(encodeURIComponent(input().fileName)));
  handlePrintPdfDownload({ method: "HEAD" }, res, new URL(file.path, "https://example.test"));
  assert.equal(body, undefined);
});

test("unknown PDF download capabilities fail closed and unrelated routes are ignored", () => {
  assert.throws(() => handlePrintPdfDownload({ method: "GET" }, {}, new URL(`https://example.test/api/print-pdfs/${"0".repeat(64)}.pdf`)), { status: 404 });
  assert.equal(handlePrintPdfDownload({ method: "GET" }, {}, new URL("https://example.test/api/work-orders")), false);
});
