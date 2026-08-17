import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../server/http/HttpError.mjs";

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
const { assertFileAccess, assertFileReadAccess, attachFileToOrder } = await import("../server/repositories/fileRepository.mjs");

test("attaching a file and its OCR records uses one transaction client", async () => {
  const calls = [];
  const client = {
    async query(query, params) {
      calls.push({ query, params });
      if (calls.length === 1) {
        return {
          rows: [{
            id: "file-1",
            order_id: "order-1",
            kind: "vehicle_license",
            storage_provider: "oss",
            bucket: "bucket",
            object_key: "key",
            original_name: "license.jpg",
            mime_type: "image/jpeg",
            size_bytes: 10,
            uploaded_by: "user-1",
            created_at: new Date("2026-08-07T00:00:00Z")
          }]
        };
      }
      return { rows: [] };
    }
  };
  let transactionCalls = 0;
  const runTransaction = async (callback) => {
    transactionCalls += 1;
    return callback(client);
  };

  const record = await attachFileToOrder("file-1", "order-1", runTransaction);

  assert.equal(transactionCalls, 1);
  assert.equal(calls.length, 2);
  assert.match(calls[0].query, /update files/i);
  assert.match(calls[1].query, /update ocr_records/i);
  assert.deepEqual(calls[0].params, ["file-1", "order-1"]);
  assert.equal(record.orderId, "order-1");
});

test("advisors can view files from every work order but cannot modify another advisor's files", async () => {
  const database = { query: async () => ({ rows: [{ uploaded_by: "user-1", advisor: "张三" }] }) };
  const advisor = { id: "user-2", role: "advisor", name: "李四" };
  await assert.doesNotReject(() => assertFileReadAccess("file-1", advisor, database));
  await assert.rejects(
    () => assertFileAccess("file-1", advisor, database),
    (error) => error instanceof HttpError && error.status === 403
  );
});
