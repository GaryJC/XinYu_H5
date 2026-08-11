import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
const { attachFileToOrder } = await import("../server/repositories/fileRepository.mjs");

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
