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
  const database = { query: async () => ({ rows: [{ uploaded_by: "user-1", advisor: "张三", shop_id: "shop-hq" }] }) };
  const advisor = { id: "user-2", role: "advisor", shopId: "shop-hq", name: "李四" };
  await assert.doesNotReject(() => assertFileReadAccess("file-1", advisor, database));
  await assert.rejects(
    () => assertFileAccess("file-1", advisor, database),
    (error) => error instanceof HttpError && error.status === 403
  );
});


test("assigned mechanics can preview reception photos without access to other shops or identity documents", async () => {
  const mechanic = {id:"tech", role:"technician", shopId:"shop-hq"};
  const file = {shop_id:"shop-hq",technician_id:"tech",technician_ids:["tech","partner"],kind:"repair_order_photo"};
  const database = {query: async () => ({rows:[file]})};
  for(const kind of ["repair_order_photo","damage_photo"]) {
    file.kind=kind;
    await assert.doesNotReject(()=>assertFileReadAccess("photo",mechanic,database));
    await assert.doesNotReject(()=>assertFileReadAccess("photo",{...mechanic,id:"partner"},database));
    await assert.rejects(()=>assertFileReadAccess("photo",{...mechanic,id:"unassigned"},database),e=>e.status===403);
    await assert.rejects(()=>assertFileReadAccess("photo",{...mechanic,shopId:"other"},database),e=>e.status===403);
  }
  for(const kind of ["vehicle_license","signature_image"]) {
    file.kind=kind;
    await assert.rejects(()=>assertFileReadAccess("photo",mechanic,database),e=>e.status===403);
  }
});

test('warehouse reads only signed same-shop parts photos and cannot modify files',async()=>{
 const user={id:'w',role:'warehouse',active:true,shopId:'shop-hq'};
 const file={kind:'repair_parts_photo',status:'维修中',shop_id:'shop-hq'};
 const database={query:async()=>({rows:[file]})};
 await assertFileReadAccess('parts',user,database);
 for(const kind of ['vehicle_license','signature_image','repair_progress_photo','other']) {
   file.kind=kind;await assert.rejects(()=>assertFileReadAccess('parts',user,database),e=>e.status===403);
 }
 file.kind='repair_parts_photo';file.status='草稿';await assert.rejects(()=>assertFileReadAccess('parts',user,database),e=>e.status===403);
 file.status='维修中';file.shop_id='other';await assert.rejects(()=>assertFileReadAccess('parts',user,database),e=>e.status===403);
 file.shop_id='shop-hq';await assert.rejects(()=>assertFileAccess('parts',user,database),e=>e.status===403);
});
