import assert from "node:assert/strict";
import test from "node:test";
import { updateWorkOrderPhoto } from "../server/repositories/workOrderPhotoRepository.mjs";
import { rowToWorkOrder } from "../server/domain/workOrderModel.mjs";

const actor = {id:"u1", name:"顾问", role:"advisor", active:true, shopId:"shop1"};
function fixture(options = {}) {
  const calls=[];
  const order={id:"order1",shop_id:"shop1",advisor:"顾问",status:"已委托",
    inspection:{belongings:["行驶证"],fuelLevel:"1/2",preRepairPhotos:{front45:"old-front",rear45:"rear",extra:["old-extra"]}},...options.order};
  const file={id:"new",kind:"repair_order_photo",mime_type:"image/jpeg",uploaded_by:"u1",order_id:null,...options.file};
  const previous={id:"old-extra",kind:"repair_order_photo",order_id:"order1",...options.previous};
  const client={query:async(query,params)=>{
    calls.push({query,params});
    if(query.startsWith("select * from work_orders")) return {rows:options.missingOrder?[]:[order]};
    if(query.startsWith("select * from files where id=$1 and")) return {rows:options.missingPrevious?[]:[previous]};
    if(query.startsWith("select * from files")) return {rows:options.missingFile?[]:[file]};
    return {rows:[]};
  }};
  return {client,calls,order};
}
const changedInspection = calls => JSON.parse(calls.find(c=>c.query.startsWith("update work_orders")).params[1]);

test("submitted photo replacement changes only the selected slot and adds an audit record", async()=>{
  const {client,calls,order}=fixture();
  await updateWorkOrderPhoto(client,"order1",{slot:"front45",fileId:"new"},actor);
  const inspection=changedInspection(calls);
  assert.equal(inspection.preRepairPhotos.front45,"new");
  assert.equal(inspection.preRepairPhotos.rear45,"rear");
  assert.deepEqual(inspection.belongings,order.inspection.belongings);
  assert.match(calls[0].query,/for update/);
  assert.ok(calls.some(c=>c.query.startsWith("insert into audit_logs")));
  assert.ok(!calls.some(c=>/delete |legacy_sync|update signatures|status\s*=|vehicle_/.test(c.query)));
});

test("extra photo can be replaced in place while retaining the original attachment", async()=>{
  const {client,calls}=fixture();
  await updateWorkOrderPhoto(client,"order1",{slot:"extra",fileId:"new",replaceFileId:"old-extra"},actor);
  const inspection=changedInspection(calls);
  assert.deepEqual(inspection.preRepairPhotos.extra,["new"]);
  assert.deepEqual(inspection.replacedPhotoIds,["old-extra"]);
  assert.ok(!calls.some(c=>/delete/i.test(c.query)));
  const reloaded=rowToWorkOrder({inspection},[],[],[],[],[],[],[]);
  assert.deepEqual(reloaded.inspection.replacedPhotoIds,["old-extra"]);
});

test("license and other photo replacements preserve signed data and hide the old thumbnail", async()=>{
  for(const [slot,kind] of [["vehicleLicense","vehicle_license"],["other","other"]]) {
    const {client,calls}=fixture({file:{kind},previous:{id:"old-photo",kind}});
    await updateWorkOrderPhoto(client,"order1",{slot,fileId:"new",replaceFileId:"old-photo"},actor);
    assert.deepEqual(changedInspection(calls).replacedPhotoIds,["old-photo"]);
    assert.equal(changedInspection(calls).preRepairPhotos.front45,"old-front");
  }
});

test("all submitted workflow stages support supplementary photos, drafts stay in the editor workflow", async()=>{
  for(const status of ["待客户签字","已委托","待派工","待领料","维修中","待结算","完成"]) {
    const {client}=fixture({order:{status}});
    await assert.doesNotReject(()=>updateWorkOrderPhoto(client,"order1",{slot:"extra",fileId:"new"},actor));
  }
  const {client}=fixture({order:{status:"草稿"}});
  await assert.rejects(()=>updateWorkOrderPhoto(client,"order1",{slot:"extra",fileId:"new"},actor),e=>e.status===409);
});

test("photo mutations reject other shops, unassigned advisors, inactive accounts and technicians before writes", async()=>{
  for(const patch of [{shopId:"other"},{name:"其他顾问"},{active:false},{role:"technician"}]) {
    const {client,calls}=fixture();
    await assert.rejects(()=>updateWorkOrderPhoto(client,"order1",{slot:"extra",fileId:"new"},{...actor,...patch}),e=>e.status===403);
    assert.equal(calls.length,1);
  }
});

test("file ownership, type, existing association and stale replacements are enforced",async()=>{
  for(const options of [
    {file:{uploaded_by:"other"}}, {file:{order_id:"order2"}}, {file:{kind:"signature_image"}},
    {file:{mime_type:"text/html"}}, {missingFile:true}, {missingPrevious:true},
    {order:{inspection:{replacedPhotoIds:["old-extra"],preRepairPhotos:{extra:["old-extra"]}}}}
  ]) {
    const {client,calls}=fixture(options);
    await assert.rejects(()=>updateWorkOrderPhoto(client,"order1",{slot:"extra",fileId:"new",replaceFileId:"old-extra"},actor));
    assert.ok(!calls.some(c=>/^(update|insert|delete)/.test(c.query)));
  }
});

test("invalid photo slot and missing IDs are rejected before accessing the database",async()=>{
  for(const input of [null,{}, {slot:"signature",fileId:"new"},{slot:"extra",fileId:""},{slot:"extra",fileId:"new",replaceFileId:2},{slot:"extra",fileId:"new",replaceFileId:"new"}]) {
    const {client,calls}=fixture();
    await assert.rejects(()=>updateWorkOrderPhoto(client,"order1",input,actor),e=>e.status===400);
    assert.equal(calls.length,0);
  }
});
