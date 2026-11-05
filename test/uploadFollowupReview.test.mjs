import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compiled=ts.transpileModule(readFileSync(new URL('../client/src/features/work-order-photos/useOrderPhotoUpload.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const file={name:'photo.jpg'};
function setup({slot='front45',replace=true,loseResponse=true,afterCommit,failRead=false,commit=true,onUpdated}={}) {
 const state=[],cleanups=[],updates=[],calls={upload:0,save:0,remove:0,read:0};
 let order={id:'order-1',inspection:{preRepairPhotos:{[slot]:slot==='extra'?['old-photo']:'old-photo'},vehicleLicenseFileId:'old-photo',replacedPhotoIds:[]},files:[{id:'old-photo',orderId:'order-1',kind:slot==='vehicleLicense'?'vehicle_license':slot==='other'?'other':'repair_order_photo'}]};
 const api={
  async uploadFile(input){calls.upload++;return {id:`new-photo-${calls.upload}`,kind:input.kind};},
  async updatePhoto(id,input){
   calls.save++;
   if(commit) {
    order.files.push({id:input.fileId,orderId:id,kind:slot==='vehicleLicense'?'vehicle_license':slot==='other'?'other':'repair_order_photo'});
    if(input.replaceFileId)order.inspection.replacedPhotoIds.push(input.replaceFileId);
    if(input.slot==='vehicleLicense')order.inspection.vehicleLicenseFileId=input.fileId;
    else if(input.slot==='extra')order.inspection.preRepairPhotos.extra=input.replaceFileId?[input.fileId]:[...(order.inspection.preRepairPhotos.extra||[]),input.fileId];
    else if(input.slot!=='other')order.inspection.preRepairPhotos[input.slot]=input.fileId;
    afterCommit?.(order);
   }
   if(loseResponse)throw new Error('保存响应丢失');
   return structuredClone(order);
  },
  async deletePhotos(_id,input){calls.remove++;if(commit)order.inspection.replacedPhotoIds.push(...input.fileIds);afterCommit?.(order);if(loseResponse)throw new Error('删除响应丢失');return structuredClone(order);},
  async get(){calls.read++;if(failRead)throw new Error('无法重新读取');return structuredClone(order);}
 };
 const exports={};
 vm.runInNewContext(compiled,{exports,Error,require(name){
  if(name==='react')return {useState(initial){const i=state.length;state.push(initial);return [initial,value=>{state[i]=value;}];},useRef:current=>({current}),useEffect:effect=>cleanups.push(effect())};
  if(name.endsWith('workOrderApi'))return {workOrderApi:api};
  if(name.endsWith('prepareOcrImage'))return {prepareUploadPhoto:async()=>({fileName:file.name,mimeType:'image/jpeg',imageBase64:'image'}),prepareOcrImage:async()=>({fileName:file.name,mimeType:'image/jpeg',imageBase64:'image'})};
  throw new Error(name);
 }});
 const actions=exports.useOrderPhotoUpload('order-1','advisor',next=>{updates.push(next);return onUpdated?.(next);});
 return {actions,state,updates,calls,api,order,upload:()=>actions.upload(slot,file,replace?'old-photo':undefined),unmount:()=>cleanups.forEach(cleanup=>cleanup?.())};
}

for(const slot of ['front45','rear45','mileage','vehicleLicense','extra','other']) {
 test(`a committed ${slot} replacement recovers its lost response without uploading twice`,async()=>{
  const s=setup({slot});assert.equal(await s.upload(),true);
  assert.equal(s.updates.length,1);assert.deepEqual(s.calls,{upload:1,save:1,remove:0,read:1});
  assert.equal(s.state[1],'');assert.equal(s.state[3],'已更换');
 });
}

test('a recovered addition continues a batch without duplicating committed attachments',async()=>{
 const s=setup({slot:'extra',replace:false});assert.equal(await s.actions.uploadMany('extra',[file,file]),true);
 assert.deepEqual(s.calls,{upload:2,save:2,remove:0,read:2});assert.equal(s.updates.length,2);
 assert.deepEqual(s.order.inspection.preRepairPhotos.extra,['old-photo','new-photo-1','new-photo-2']);
});

test('ordinary successful uploads do not add recovery reads',async()=>{
 const s=setup({loseResponse:false});assert.equal(await s.upload(),true);assert.equal(s.calls.read,0);
 assert.equal(await s.actions.remove(['old-photo']),true);assert.equal(s.calls.read,0);
});

for(const [label,afterCommit] of [
 ['foreign order',order=>{order.id='order-2';}],
 ['wrong slot',order=>{order.inspection.preRepairPhotos.front45='another-file';}],
 ['detached file',order=>{order.files.find(f=>f.id==='new-photo-1').orderId='order-2';}],
 ['wrong kind',order=>{order.files.find(f=>f.id==='new-photo-1').kind='signature_image';}],
 ['already replaced new photo',order=>{order.inspection.replacedPhotoIds.push('new-photo-1');}],
 ['replacement not persisted',order=>{order.inspection.replacedPhotoIds=[];}]
])test(`upload recovery rejects ${label}`,async()=>{
 const s=setup({afterCommit});assert.equal(await s.upload(),false);assert.equal(s.updates.length,0);assert.equal(s.state[1],'保存响应丢失');
});

test('failed saves and unavailable recovery reads preserve the original error',async()=>{
 for(const options of [{commit:false},{failRead:true}]) {
  const s=setup(options);assert.equal(await s.upload(),false);assert.equal(s.updates.length,0);assert.equal(s.state[1],'保存响应丢失');assert.equal(s.calls.save,1);
 }
});

test('a committed deletion recovers only when every requested photo is recorded as removed',async()=>{
 const s=setup();assert.equal(await s.actions.remove(['old-photo']),true);assert.equal(s.updates.length,1);assert.equal(s.state[3],'已删除');assert.equal(s.calls.remove,1);assert.equal(s.calls.read,1);
 for(const options of [{commit:false},{afterCommit:order=>{order.id='another-order';}},{failRead:true},{afterCommit:order=>{order.inspection.replacedPhotoIds=['old-photo'];}}]) {
  const failed=setup(options);assert.equal(await failed.actions.remove(['old-photo','another-photo']),false);assert.equal(failed.updates.length,0);assert.equal(failed.state[1],'删除响应丢失');
 }
});

test('closing an order while recovery is pending never applies the stale result',async()=>{
 const s=setup();let release;const gate=new Promise(resolve=>{release=resolve;});let started;const reading=new Promise(resolve=>{started=resolve;});
 const get=s.api.get;s.api.get=async()=>{started();await gate;return get();};
 const pending=s.upload();await reading;s.unmount();release();assert.equal(await pending,false);assert.equal(s.updates.length,0);
});

test('a failed page callback never retries writes or reports a committed attachment change as failed',async()=>{
 for(const loseResponse of [false,true])for(const callback of [()=>{throw new Error('page failed');},async()=>{throw new Error('page failed');}]) {
  const uploaded=setup({loseResponse,onUpdated:callback});
  assert.equal(await uploaded.upload(),true);assert.equal(uploaded.updates.length,1);assert.match(uploaded.state[1],/照片已保存.*页面更新失败/);
  assert.deepEqual(uploaded.calls,{upload:1,save:1,remove:0,read:loseResponse?1:0});
  const deleted=setup({loseResponse,onUpdated:callback});
  assert.equal(await deleted.actions.remove(['old-photo']),true);assert.equal(deleted.updates.length,1);assert.match(deleted.state[1],/照片已删除.*页面更新失败/);
  assert.deepEqual(deleted.calls,{upload:0,save:0,remove:1,read:loseResponse?1:0});
 }
});
