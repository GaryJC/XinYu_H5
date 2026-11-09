import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { withRequestTiming, measureStage, writeTimingHeaders } from "../server/http/requestTiming.mjs";

function response() {
  const res = new EventEmitter();
  res.headers = {};
  res.setHeader = (name, value) => { res.headers[name] = value; };
  return res;
}

test("parallel requests keep their own timings and request IDs", async () => {
  const a = response();
  const b = response();
  await Promise.all([
    withRequestTiming({ method: "POST" }, a, "/api/ocr/vin", async () => {
      await measureStage("aliyun_ocr", async () => {});
      writeTimingHeaders(a);
    }),
    withRequestTiming({ method: "POST" }, b, "/api/company-system/vehicles/lookup", async () => {
      await measureStage("vehicle_lookup", async () => {});
      writeTimingHeaders(b);
    })
  ]);
  assert.notEqual(a.headers["X-Request-Id"], b.headers["X-Request-Id"]);
  assert.match(a.headers["Server-Timing"], /aliyun_ocr;dur=/);
  assert.doesNotMatch(a.headers["Server-Timing"], /vehicle_lookup/);
  assert.match(b.headers["Server-Timing"], /vehicle_lookup;dur=/);
  assert.doesNotMatch(b.headers["Server-Timing"], /aliyun_ocr/);
});

test("failed stages retain timing and propagate the original error", async () => {
  const res = response();
  const failure = new Error("provider unavailable");
  await withRequestTiming({ method: "POST" }, res, "/api/ocr/vehicle-license", async () => {
    await assert.rejects(() => measureStage("aliyun_ocr", async () => { throw failure; }), (error) => error === failure);
    writeTimingHeaders(res);
  });
  assert.match(res.headers["Server-Timing"], /aliyun_ocr;dur=/);
});

test("non API requests receive no diagnostic headers", async () => {
  const res = response();
  await withRequestTiming({ method: "GET" }, res, "/assets/app.js", async () => {
    await measureStage("test", async () => {});
    writeTimingHeaders(res);
  });
  assert.deepEqual(res.headers, {});
});

test("error requests are logged with route templates and no identifiers or bodies", async () => {
  const lines=[],original=console.info;console.info=(...values)=>lines.push(values);
  try {
    const res=response();res.statusCode=500;
    await withRequestTiming({method:'POST',body:{password:'private'}},res,'/api/work-orders/customer-secret/actions',async()=>{});
    res.emit('finish');assert.equal(lines.length,1);
    const record=JSON.parse(lines[0][1]);assert.equal(record.path,'/api/work-orders/:id/actions');
    assert.doesNotMatch(JSON.stringify(record),/customer-secret|password|private/);
  } finally {console.info=original;}
});
