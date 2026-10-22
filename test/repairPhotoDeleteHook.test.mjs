import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source=readFileSync(new URL('../client/src/features/dispatch/useRepairPhotos.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function setup(api) {
  const state=[],cleanups=[];let refreshes=0;
  const exports={};
  vm.runInNewContext(compiled,{exports,Error,require(name){
    if(name==='react')return {
      useState(initial){const i=state.length;state.push(initial);return [initial,value=>{state[i]=value;}];},
      useRef(value){return {current:value};},useEffect(effect){cleanups.push(effect());}
    };
    if(name.endsWith('dispatchApi'))return {dispatchApi:api};
    if(name.endsWith('requestId'))return {createRequestId:()=> 'request1'};
    if(name.endsWith('prepareOcrImage'))return {prepareUploadPhoto:async()=>({imageBase64:'image'})};
    throw new Error(name);
  }});
  const controller={detail:{task:{orderId:'order1',repairRound:0}},busy:false,refreshDetail:async()=>{refreshes++;}};
  const actions=exports.useRepairPhotos(controller,()=>{});
  return {actions,state,controller,get refreshes(){return refreshes;},unmount:()=>cleanups.forEach(fn=>fn?.())};
}
test('repair photo deletion sends one batch, blocks duplicate clicks and refreshes once',async()=>{
  let release,calls=0;
  const gate=new Promise(resolve=>{release=resolve;});
  const h=setup({async deletePhotos(orderId,body){calls++;assert.equal(orderId,'order1');assert.deepEqual(body.fileIds,['a','b']);await gate;}});
  const pending=h.actions.deletePhotos(['a','b']);
  assert.equal(await h.actions.deletePhotos(['a']),false);
  assert.equal(h.state[0],true);
  release();assert.equal(await pending,true);
  assert.equal(calls,1);assert.equal(h.refreshes,1);assert.equal(h.state[0],false);
});
test('failed deletion reports failure without refreshing and permits a retry',async()=>{
  let fail=true;
  const h=setup({async deletePhotos(){if(fail)throw new Error('删除失败');}});
  assert.equal(await h.actions.deletePhotos(['a']),false);
  assert.equal(h.state[1],'删除失败');assert.equal(h.refreshes,0);
  fail=false;assert.equal(await h.actions.deletePhotos(['a']),true);
  assert.equal(h.state[1],'');assert.equal(h.refreshes,1);
});
test('leaving the task ignores a late deletion response',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const h=setup({async deletePhotos(){await gate;}});
  const pending=h.actions.deletePhotos(['a']);h.unmount();release();
  assert.equal(await pending,false);assert.equal(h.refreshes,0);
});
test('pending uploads, busy tasks and empty selections block deletion',async()=>{
  let release,calls=0;const gate=new Promise(resolve=>{release=resolve;});
  const h=setup({async deletePhotos(){calls++;},async uploadPhoto(){await gate;}});
  assert.equal(await h.actions.deletePhotos([]),false);
  h.controller.busy=true;assert.equal(await h.actions.deletePhotos(['a']),false);h.controller.busy=false;
  const upload=h.actions.select({name:'photo.jpg'});
  assert.equal(await h.actions.deletePhotos(['a']),false);
  release();await upload;assert.equal(calls,0);
});
