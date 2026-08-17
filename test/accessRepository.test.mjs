import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../server/http/HttpError.mjs";

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
const { assertOcrRecordAccess, assertWorkOrderAccess } = await import("../server/repositories/accessRepository.mjs");

test("work-order mutations remain scoped to the owning advisor", async () => {
  const database = { query: async () => ({ rows: [{ advisor: "张三" }] }) };
  await assert.doesNotReject(() => assertWorkOrderAccess("order-1", { role: "advisor", name: "张三" }, database));
  await assert.rejects(
    () => assertWorkOrderAccess("order-1", { role: "advisor", name: "李四" }, database),
    (error) => error instanceof HttpError && error.status === 403
  );
});

test("draft OCR access is scoped to the uploader", async () => {
  const database = { query: async () => ({ rows: [{ uploaded_by: "user-1", advisor: null }] }) };
  await assert.doesNotReject(() => assertOcrRecordAccess("ocr-1", { id: "user-1", role: "advisor", name: "张三" }, database));
  await assert.rejects(
    () => assertOcrRecordAccess("ocr-1", { id: "user-2", role: "advisor", name: "李四" }, database),
    (error) => error instanceof HttpError && error.status === 403
  );
});
