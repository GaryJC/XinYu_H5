import assert from "node:assert/strict";
import test from "node:test";
import { assertPreRepairPhotosReady, preRepairPhotoIds } from "../server/domain/preRepairPhotos.mjs";
import { attachPreRepairPhotos } from "../server/repositories/preRepairPhotoRepository.mjs";
import { rowToWorkOrder, workOrderValues } from "../server/domain/workOrderModel.mjs";

const photos = { front45: "front", rear45: "rear", mileage: "meter", extra: ["detail"] };
const order = {
  id: "order-1", inspection: { preRepairPhotos: photos },
  files: Object.values(photos).flat().map((id) => ({ id, orderId: "order-1", kind: "repair_order_photo" }))
};

test("drafts permit incomplete photos; signing requires two separate uploaded views and mileage is optional", () => {
  assert.deepEqual(preRepairPhotoIds({}), []);
  assert.throws(() => assertPreRepairPhotosReady({}), /斜前方.*斜后方/);
  assert.throws(() => assertPreRepairPhotosReady({ ...order, inspection: { preRepairPhotos: { front45: "front" } } }), /斜后方/);
  assert.doesNotThrow(() => assertPreRepairPhotosReady(order));
  assert.doesNotThrow(() => assertPreRepairPhotosReady({ ...order, inspection: { preRepairPhotos: { front45: "front", rear45: "rear" } } }));
  assert.throws(() => preRepairPhotoIds({ ...photos, rear45: "front" }), /分别上传不同/);
});

test("photos from other orders and unrelated file kinds cannot satisfy required photos", () => {
  assert.throws(() => assertPreRepairPhotosReady({ ...order, files: order.files.slice(1) }), /未关联/);
  assert.throws(() => assertPreRepairPhotosReady({ ...order, files: order.files.map((file) => ({ ...file, orderId: "other" })) }), /未关联/);
  assert.throws(() => assertPreRepairPhotosReady({ ...order, files: order.files.map((file) => ({ ...file, kind: "vehicle_license" })) }), /未关联/);
  assert.throws(() => preRepairPhotoIds({ extra: "bad" }), /额外照片格式/);
  assert.throws(() => preRepairPhotoIds({ mileage: 42 }), /文件 ID/);
});

test("draft photo attachment checks ownership and attaches all photos together", async () => {
  const queries = [];
  const client = { async query(sql, params) {
    queries.push({ sql, params });
    return { rows: params[0].map((id) => ({ id })) };
  } };
  await attachPreRepairPhotos(client, order, "advisor-1");
  assert.match(queries[0].sql, /uploaded_by = \$3/);
  assert.match(queries[0].sql, /order_id is null/);
  assert.match(queries[0].sql, /for update/);
  assert.deepEqual(queries[0].params, [["front", "rear", "meter", "detail"], "order-1", "advisor-1"]);
  assert.match(queries[1].sql, /update files set order_id/);
});

test("a missing or inaccessible photo aborts attachment before any file is changed", async () => {
  let calls = 0;
  await assert.rejects(() => attachPreRepairPhotos({ async query() {
    calls++;
    return { rows: [{ id: "front" }] };
  } }, order, "advisor-1"), /不存在、无权使用/);
  assert.equal(calls, 1);
});

test("photo slots survive work-order JSON persistence and historical orders still load", () => {
  const inspection = { belongings: [], fuelLevel: "1/2", exteriorIssues: [], preRepairPhotos: photos };
  const values = workOrderValues({ inspection });
  assert.deepEqual(JSON.parse(values[24]).preRepairPhotos, photos);
  const restored = rowToWorkOrder({ inspection, created_at: new Date(), updated_at: new Date() }, [], [], [], [], [], [], []);
  assert.deepEqual(restored.inspection.preRepairPhotos, photos);
  const historical = rowToWorkOrder({ inspection: {}, created_at: new Date(), updated_at: new Date() }, [], [], [], [], [], [], []);
  assert.deepEqual(historical.inspection.preRepairPhotos, {});
});
