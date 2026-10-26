import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../client/src/features/work-order-photos/useOrderPhotoUpload.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function setup(api, customer) {
  const state = [], updates = [], cleanups = [], prepared = [];
  const exports = {};
  const prepare = async (file, uploadedAt, extraLines) => { prepared.push({file, uploadedAt, extraLines}); return {fileName:file.name,mimeType:"image/jpeg",imageBase64:"image"}; };
  vm.runInNewContext(compiled, { exports, Error, require(name) {
    if (name === "react") return {
      useState(initial) { const i = state.length; state.push(initial); return [initial, value => { state[i] = value; }]; },
      useRef(value) { return { current: value }; },
      useEffect(effect) { cleanups.push(effect()); }
    };
    if (name.endsWith("workOrderApi")) return { workOrderApi: api };
    if (name.endsWith("prepareOcrImage")) return { prepareUploadPhoto: prepare, prepareOcrImage: prepare };
    throw new Error(`Unexpected import ${name}`);
  }});
  const actions = exports.useOrderPhotoUpload("order1", "user1", order => updates.push(order), customer);
  return {actions,state,updates,prepared,unmount:()=>cleanups.forEach(cleanup=>cleanup?.())};
}
const files = [{name:"one.jpg"},{name:"two.jpg"},{name:"three.jpg"}];
test('submitted photo replacements include the current order contact and phone', async () => {
  const h = setup({async uploadFile(){return {id:'new'};},async updatePhoto(id){return {id};}}, {contact:' 李四 ',phone:' 13900000000 '});
  for (const slot of ['front45','rear45']) assert.equal(await h.actions.upload(slot,files[0],'old'),true);
  for (const image of h.prepared) assert.deepEqual(Array.from(image.extraLines),['联系人：李四','联系电话：13900000000']);
});
test('submitted front and rear replacements request timestamps without watermarking documents or other photos', async () => {
  const h = setup({async uploadFile(){return {id:'new'};},async updatePhoto(id){return {id};}});
  for (const slot of ['front45','rear45','mileage','extra','other','vehicleLicense']) assert.equal(await h.actions.upload(slot,files[0],'old'),true);
  assert.deepEqual(h.prepared.map(item => Boolean(item.uploadedAt)),[true,true,false,false,false,false]);
});

test("photo batch uploads and saves every image in selection order", async () => {
  const calls = [];
  const h = setup({
    async uploadFile(file) { calls.push(file.fileName); return {id:file.fileName}; },
    async updatePhoto(id, photo) { calls.push(photo.fileId); return {id, latest:photo.fileId}; }
  });
  assert.equal(await h.actions.uploadMany("other",files),true);
  assert.deepEqual(calls,["one.jpg","one.jpg","two.jpg","two.jpg","three.jpg","three.jpg"]);
  assert.equal(h.updates.length,3);
  assert.equal(h.state[0],"");
  assert.equal(h.state[2],true);
});

test("partial failure retains saved images and reports how many succeeded", async () => {
  const h = setup({
    async uploadFile(file) { if (file.fileName === "two.jpg") throw new Error("上传失败"); return {id:file.fileName}; },
    async updatePhoto(id) { return {id}; }
  });
  assert.equal(await h.actions.uploadMany("extra",files),false);
  assert.equal(h.updates.length,1);
  assert.match(h.state[1],/已上传 1 张/);
  assert.equal(h.state[0],"");
  assert.equal(h.state[2],false);
});

test("batch lock blocks overlapping uploads and deletion until the entire batch ends", async () => {
  let release;
  const gate = new Promise(resolve => {release=resolve;});
  const h = setup({
    async uploadFile(file) { await gate; return {id:file.fileName}; },
    async updatePhoto(id) { return {id}; },
    async deletePhotos() { throw new Error("must not delete during upload"); }
  });
  const pending = h.actions.uploadMany("extra",files);
  assert.equal(await h.actions.upload("other",files[0]),false);
  assert.equal(await h.actions.remove(["old"]),false);
  release();
  assert.equal(await pending,true);
  assert.equal(h.updates.length,3);
});

test("leaving an order during upload stops remaining work and ignores stale results", async () => {
  let release;
  const gate = new Promise(resolve=>{release=resolve;});
  let saves=0;
  const h = setup({async uploadFile() {await gate;return {id:"new"};},async updatePhoto() {saves++;}});
  const pending = h.actions.uploadMany("other",files);
  await Promise.resolve();
  h.unmount(); release();
  assert.equal(await pending,false);
  assert.equal(saves,0);
  assert.equal(h.updates.length,0);
});

test("failed batch deletion preserves the displayed order and surfaces the error", async () => {
  const h=setup({async deletePhotos() {throw new Error("纸质委托书至少保留一张照片");}});
  assert.equal(await h.actions.remove(["old"]),false);
  assert.match(h.state[1],/至少保留一张/);
  assert.equal(h.updates.length,0);
  assert.equal(h.state[0],"");
});

test("submitted replacement failure keeps the old order and provides an awaited failure result", async () => {
  const h = setup({async uploadFile() {return {id:"new"};}, async updatePhoto() {throw new Error("保存失败");}});
  assert.equal(await h.actions.upload("front45",files[0],"old-front"),false);
  assert.equal(h.updates.length,0);
  assert.match(h.state[1],/保存失败/);
});
test("submitted photo feedback distinguishes adding, replacing and deletion", async () => {
  const h=setup({async uploadFile(){return {id:"new"};},async updatePhoto(id){return {id};},async deletePhotos(id){return {id};}});
  assert.equal(await h.actions.upload("extra",files[0]),true);
  assert.equal(h.state[3],"已添加");
  assert.equal(await h.actions.upload("extra",files[0],"old"),true);
  assert.equal(h.state[3],"已更换");
  assert.equal(await h.actions.remove(["old"]),true);
  assert.equal(h.state[3],"已删除");
});
