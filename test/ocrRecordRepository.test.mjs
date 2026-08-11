import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../server/http/HttpError.mjs";

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
const { confirmOcrRecord, createOcrRecord } = await import("../server/repositories/ocrRecordRepository.mjs");

test("OCR records require a real uploaded file id", async () => {
  await assert.rejects(
    () => createOcrRecord({ field: "vehicleLicense", source: "行驶证照片" }, { query: async () => ({ rows: [] }) }),
    (error) => error instanceof HttpError && error.status === 400
  );
});

test("creating an attached OCR record writes its audit trail", async () => {
  const calls = [];
  const database = {
    async query(query, params) {
      calls.push({ query, params });
      if (/select \*/i.test(query)) {
        return {
          rows: [{
            id: params[0],
            order_id: "order-1",
            field: "vehicleLicense",
            source: "行驶证照片",
            file_id: "file-1",
            status: "待确认",
            value: "{}",
            confidence: 0.9,
            created_at: new Date("2026-08-07T00:00:00Z")
          }]
        };
      }
      return { rows: [] };
    }
  };

  const record = await createOcrRecord({
    orderId: "order-1",
    field: "vehicleLicense",
    source: "行驶证照片",
    fileId: "file-1",
    value: "{}",
    confidence: 0.9
  }, database);

  assert.equal(calls.length, 3);
  assert.match(calls[0].query, /insert into ocr_records/i);
  assert.match(calls[1].query, /insert into audit_logs/i);
  assert.equal(record.fileId, "file-1");
});

test("confirming an already confirmed OCR record is idempotent", async () => {
  const calls = [];
  const row = {
    id: "ocr-1",
    order_id: "order-1",
    field: "vehicleLicense",
    source: "行驶证照片",
    file_id: "file-1",
    status: "已确认",
    value: "{}",
    confidence: 0.9,
    created_at: new Date("2026-08-07T00:00:00Z"),
    confirmed_at: new Date("2026-08-07T00:01:00Z")
  };
  const database = {
    async query(query) {
      calls.push(query);
      return { rows: [row] };
    }
  };
  const runTransaction = async (callback) => callback(database);

  const record = await confirmOcrRecord("ocr-1", "changed", "张三", { database, runTransaction });

  assert.equal(record.status, "已确认");
  assert.equal(calls.length, 2);
  assert.match(calls[0], /for update/i);
  assert.ok(calls.every((query) => !/update ocr_records/i.test(query)));
});
