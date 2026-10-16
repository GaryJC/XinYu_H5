import test from "node:test";
import assert from "node:assert/strict";
import { attachDraftVehicleLicense } from "../server/repositories/draftVehicleLicenseRepository.mjs";
import { rowToWorkOrder, workOrderValues } from "../server/domain/workOrderModel.mjs";

test("saving a license reference without any OCR result attaches the image inside the draft transaction", async()=>{
  const calls=[];
  const client={query:async(query,params)=>{calls.push({query,params});return {rows:query.startsWith("select")?[{id:"license"}]:[]};}};
  await attachDraftVehicleLicense(client,{id:"order",inspection:{vehicleLicenseFileId:"license"}},"u1");
  assert.deepEqual(calls[0].params,["license","order","u1"]);
  assert.match(calls[0].query,/kind='vehicle_license'/);
  assert.match(calls[0].query,/order_id is null and uploaded_by=\$3/);
  assert.match(calls[0].query,/for update/);
  assert.match(calls[1].query,/update files/);
  assert.match(calls[2].query,/update ocr_records/);
});

test("invalid or inaccessible licenses fail the draft save before any attachment changes",async()=>{
  for (const fileId of ["missing","",12,null]) {
    const writes=[];
    const client={query:async(query)=>{if(!query.startsWith("select"))writes.push(query);return {rows:[]};}};
    await assert.rejects(()=>attachDraftVehicleLicense(client,{id:"order",inspection:{vehicleLicenseFileId:fileId}},"u1"),e=>e.status===400);
    assert.equal(writes.length,0);
  }
});

test("orders without a license stay optional; a saved reference survives reload independently of OCR",async()=>{
  const client={query:async()=>{throw Error("unexpected query");}};
  await attachDraftVehicleLicense(client,{id:"order"},"u1");
  const inspection={vehicleLicenseFileId:"license",belongings:[],fuelLevel:"1/2",exteriorIssues:[]};
  const values=workOrderValues({inspection});
  const saved=JSON.parse(values[24]);
  const order=rowToWorkOrder({inspection:saved},[],[],[],[],[],[],[]);
  assert.equal(order.inspection.vehicleLicenseFileId,"license");
});
