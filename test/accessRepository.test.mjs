import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../server/http/HttpError.mjs";

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
const { assertOcrRecordAccess, assertWorkOrderAccess, assertWorkOrderReadAccess } = await import("../server/repositories/accessRepository.mjs");

test("archive detail reads allow same-shop advisors without granting mutation or cross-shop access", async () => {
  const database = { query: async () => ({ rows: [{ advisor: "张三", shop_id: "shop-hq" }] }) };
  const advisor = { role: "advisor", shopId: "shop-hq", name: "李四" };
  await assertWorkOrderReadAccess("order-1", advisor, database);
  await assertWorkOrderReadAccess("order-1", {...advisor, role:'technician', roles:['technician','advisor']}, database);
  await assert.rejects(() => assertWorkOrderAccess("order-1", advisor, database), e => e.status === 403);
  for (const user of [{...advisor,shopId:'elsewhere'}, {...advisor,shopId:undefined}, ...['employee','technician','inspector','outsourcing'].map(role=>({...advisor,role}))]) {
    await assert.rejects(() => assertWorkOrderReadAccess("order-1", user, database), e => e.status === 403);
  }
  await assert.rejects(() => assertWorkOrderReadAccess("missing", advisor, {query:async()=>({rows:[]})}), e => e.status === 404);
});

test("work-order mutations remain scoped to the owning advisor", async () => {
  const database = { query: async () => ({ rows: [{ advisor: "张三", shop_id: "shop-hq" }] }) };
  await assert.doesNotReject(() => assertWorkOrderAccess("order-1", { role: "advisor", shopId: "shop-hq", name: "张三" }, database));
  await assert.rejects(
    () => assertWorkOrderAccess("order-1", { role: "advisor", shopId: "shop-hq", name: "李四" }, database),
    (error) => error instanceof HttpError && error.status === 403
  );
});

test("draft OCR access is scoped to the uploader", async () => {
  const database = { query: async () => ({ rows: [{ uploaded_by: "user-1", advisor: null, shop_id: "shop-hq" }] }) };
  await assert.doesNotReject(() => assertOcrRecordAccess("ocr-1", { id: "user-1", role: "advisor", shopId: "shop-hq", name: "张三" }, database));
  await assert.rejects(
    () => assertOcrRecordAccess("ocr-1", { id: "user-2", role: "advisor", shopId: "shop-hq", name: "李四" }, database),
    (error) => error instanceof HttpError && error.status === 403
  );
});
