import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {hasRole} from '../shared/roles.mjs';
const require=createRequire(import.meta.url);
const compile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const collectionExports={};vm.runInNewContext(compile('../client/src/features/work-order-photos/photoCollections.ts'),{exports:collectionExports});
const code=compile('../client/src/features/work-order-photos/SubmittedOrderPhotos.tsx');
function setup(section='all',paperMode) {
  const calls=[],exports={};
  const user={id:'advisor',name:'顾问',role:'advisor',active:true,shopId:'shop'};
  const file=(id,kind)=>({id,kind,mimeType:'image/jpeg',originalName:id});
  const order={id:'o',status:paperMode==='pending'?'待处理纸质委托书':'已委托',shop:{id:'shop'},advisor:'顾问',inspection:{preRepairPhotos:{front45:'front',rear45:'rear',extra:['extra']}},files:[file('front','repair_order_photo'),file('rear','repair_order_photo'),file('extra','repair_order_photo'),file('legacy','other'),file('paper','other')],paperOrder:paperMode?{mode:paperMode,photoIds:['paper']}:undefined};
  const upload={uploading:'',error:'',async upload(...args){calls.push(args);return true;},async uploadMany(...args){calls.push(args);return true;},async remove(ids){calls.push(['delete',ids]);return true;}};
  vm.runInNewContext(code,{exports,require(name){
    if(name.endsWith('roles.mjs'))return{hasRole};
    if(name==='antd')return{Alert:'Alert'};
    if(name==='./OrderPhotoGallery')return{OrderPhotoGallery:'Gallery'};
    if(name.endsWith('PreRepairPhotos'))return{PreRepairPhotos:'PreRepair'};
    if(name==='./useOrderPhotoUpload')return{useOrderPhotoUpload:()=>upload};
    if(name==='./photoCollections')return collectionExports;
    return require(name);
  }});
  const render=()=>[exports.SubmittedOrderPhotos({order,user,section,onUpdated(){}}).props.children].flat(Infinity).filter(node=>node&&typeof node==='object');
  return{calls,user,order,render};
}
test('normal detail has one supplementary album and no duplicate other-photo gallery',async()=>{
  const h=setup(),nodes=h.render();
  assert.deepEqual(nodes.filter(node=>node.type==='Gallery').map(node=>node.props.title),['行驶证照片']);
  const repair=nodes.find(node=>node.type==='PreRepair');
  assert.deepEqual(Array.from(repair.props.photos.extra),['extra','legacy','paper']);
  await repair.props.controls.replaceExtra('legacy',{name:'replace.jpg'});
  assert.equal(h.calls[0][0],'other');assert.equal(h.calls[0][2],'legacy');
  await repair.props.controls.uploadExtras([{name:'new.jpg'}]);assert.equal(h.calls[1][0],'extra');
  await repair.props.controls.removeExtras(['extra','legacy']);assert.equal(h.calls[2][0],'delete');
});
test('paper detail separates paper photos and keeps supplementary replacement paths compatible',async()=>{
  const h=setup('all','runfeng'),nodes=h.render();
  const paper=nodes.find(node=>node.type==='Gallery'&&node.props.title==='纸质委托书照片');
  assert.deepEqual(Array.from(paper.props.files,file=>file.id),['paper']);
  assert.deepEqual(Array.from(nodes.find(node=>node.type==='PreRepair').props.photos.extra),['extra','legacy']);
  assert.equal(paper.props.canAdd,false);
  await paper.props.onUpload([{name:'new-paper.jpg'}],'paper');
  assert.equal(h.calls[0][0],'other');assert.equal(h.calls[0][2],'paper');
});
test('pending paper section has paper and supplementary galleries and adds to the selected album',async()=>{
  const h=setup('other','pending'),nodes=h.render();
  assert.ok(!nodes.some(node=>node.type==='PreRepair'));
  const galleries=nodes.filter(node=>node.type==='Gallery');
  assert.deepEqual(galleries.map(node=>node.props.title),['纸质委托书照片','补充照片']);
  assert.equal(galleries[0].props.canAdd,true);
  await galleries[0].props.onUpload([{name:'paper.jpg'}]);assert.equal(h.calls[0][0],'other');
  await galleries[1].props.onUpload([{name:'supplement.jpg'}]);assert.equal(h.calls[1][0],'extra');
  await galleries[1].props.onUpload([{name:'replace.jpg'}],'legacy');assert.equal(h.calls[2][0],'other');
});
test('album unification preserves readonly permissions and editor section has no duplicate albums',()=>{
  const h=setup('repair');h.user.role='technician';
  const nodes=h.render(),repair=nodes.find(node=>node.type==='PreRepair');
  assert.equal(repair.props.disabled,true);assert.equal(repair.props.controls,undefined);
  assert.ok(!nodes.some(node=>node.type==='Gallery'));
});
