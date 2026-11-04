import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as roles from '../shared/roles.mjs';

const root=path.resolve('client/src/features');
const order={id:'onsite-order',shop:{id:'shop-hq'},advisor:'顾问',customer:{name:'客户'},status:'草稿',signatureToken:'session',signatures:{}};
const signed={...order,status:'已委托',signatureTokenUsed:true,customerSignatureFileId:'signature-file',signatures:{customer:'客户'},customerSignatureReview:{state:'confirmed',mode:'onsite'}};
function setup(flow,api,{failRefresh=false}={}) {
 const events=[],errors=[];
 function load(file) {
  const exports={};
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,require(name){
   if(name.endsWith('workOrderApi'))return {workOrderApi:api};
   if(name.endsWith('shared/roles.mjs'))return roles;
   if(name==='react')return {useRef:value=>({current:value}),useState:initial=>[initial,()=>{}]};
   return load(path.resolve(path.dirname(file),`${name}.ts`));
  }});
  return exports;
 }
 let complete;
 if(flow==='archive') {
  complete=load(path.join(root,'signature/useArchiveSignature.ts')).useArchiveSignature(
   {id:'advisor',role:'advisor',name:'顾问',shopId:'shop-hq',active:true},value=>events.push(value),()=>events.push('refresh')) .completeSignature;
 } else {
  complete=load(path.join(root,'work-orders/hooks/createWorkOrderWorkflowActions.ts')).createWorkOrderWorkflowActions({
   role:'advisor',actor:'顾问',draft:{},totalLabor:0,setFormErrors:value=>errors.push(value),setActionLoading:()=>{},
   loadOrders:async(_,id)=>{events.push(id);if(failRefresh)throw Error('列表断网');},loadDashboard:async()=>{}
  }).completeSignature;
 }
 return {complete:()=>complete(order,'session','drawn-signature'),events,errors};
}

for(const flow of ['archive','editor']) {
 test(`${flow} recovers an onsite signature whose successful response was lost`,async()=>{
  let committed=false,uploads=0,signs=0,reads=0;
  const api={uploadFile:async()=>{uploads++;return {id:'signature-file'};},signByToken:async()=>{signs++;committed=true;throw TypeError('Failed to fetch');},findByToken:async token=>{reads++;assert.equal(token,'session');return committed?signed:order;}};
  const h=setup(flow,api);
  assert.equal(await h.complete(),signed);assert.equal(uploads,1);assert.equal(signs,1);assert.equal(reads,1);assert.ok(h.events.length);
 });
 test(`${flow} recovers retry after an already consumed onsite signature session`,async()=>{
  const h=setup(flow,{uploadFile:async()=>({id:'retry-file'}),signByToken:async()=>{throw Object.assign(Error('签字链接已使用'),{status:409});},findByToken:async()=>signed});
  assert.equal(await h.complete(),signed);
 });
 test(`${flow} never treats unsigned or foreign sessions as a saved signature`,async()=>{
  const original=Object.assign(Error('签字提交失败'),{status:503});
  for(const current of [undefined,order,{...signed,id:'another-order'},{...signed,signatureTokenUsed:false},{...signed,customerSignatureFileId:undefined},{...signed,customerSignatureReview:undefined}]) {
   const h=setup(flow,{uploadFile:async()=>({id:'signature-file'}),signByToken:async()=>{throw original;},findByToken:async()=>current});
   await assert.rejects(h.complete(),error=>error===original);assert.equal(h.events.length,0);
  }
 });
 test(`${flow} preserves pending review when another device switched the session to remote signing`,async()=>{
  const pending={...signed,status:'待客户签字',customerSignatureReview:{state:'pending',mode:'remote'}};
  for(const lostResponse of [false,true]) {
   const h=setup(flow,{uploadFile:async()=>({id:'signature-file'}),signByToken:async()=>{if(lostResponse)throw Error('网络中断');return pending;},findByToken:async()=>pending});
   assert.equal(await h.complete(),pending);assert.equal(pending.customerSignatureReview.state,'pending');
  }
 });
 test(`${flow} preserves the original failure if recovery lookup also fails`,async()=>{
  const original=Error('上传中断');
  const h=setup(flow,{uploadFile:async()=>{throw original;},findByToken:async()=>{throw Error('查询中断');}});
  await assert.rejects(h.complete(),error=>error===original);assert.equal(h.events.length,0);
 });
 test(`${flow} normal success has no recovery request`,async()=>{
  let reads=0;
  const h=setup(flow,{uploadFile:async()=>({id:'signature-file'}),signByToken:async()=>signed,findByToken:async()=>{reads++;return signed;}});
  assert.equal(await h.complete(),signed);assert.equal(reads,0);
 });
}

test('editor list refresh failure does not turn a saved signature into a submission failure',async()=>{
 const h=setup('editor',{uploadFile:async()=>({id:'signature-file'}),signByToken:async()=>signed},{failRefresh:true});
 assert.equal(await h.complete(),signed);assert.match(h.errors.flat().join(''),/签字已保存/);
});

test('the signing dialog reports saved-but-pending instead of confirmed after a remote-mode race',async()=>{
 const file=path.join(root,'signature/WorkOrderSignatureDialog.tsx');
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 for(const confirmed of [false,true]) {
  const exports={},states=[],messages=[];
  const saved={...signed,customerSignatureReview:{state:confirmed?'confirmed':'pending'}};
  vm.runInNewContext(code,{exports,require(name){
   if(name==='react')return {useEffect:()=>{},useState:initial=>{const i=states.length;const value=i===1?'drawn-signature':initial;states.push(value);return [value,next=>{states[i]=next;}];}};
   if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
   if(name.endsWith('useActionFeedback'))return {useActionFeedback:()=>({success:message=>messages.push(message),error:error=>{throw error;}})};
   if(name.endsWith('useSignatureMode'))return {useSignatureMode:()=>({mode:'onsite',busy:false})};
   if(name==='antd')return {Form:{Item:'form-item'},Grid:{useBreakpoint:()=>({md:false})},Radio:{Group:'radio-group'},Button:'button',Alert:'alert',Space:'space'};
   if(name.endsWith('workOrderDomain'))return {sumLabor:()=>0};
   return new Proxy({},{get:(_,key)=>key});
  }});
  const tree=exports.WorkOrderSignatureDialog({session:{order:{...order,vehicle:{plate:'鲁BTEST'},repairItems:[]},token:'session'},completeSignature:async()=>saved,onClose:()=>{},onOrderUpdated:()=>{}});
  const sign=tree.props.children[0].props.footer.find(button=>button?.props?.onClick&&button.props.type==='primary');
  await sign.props.onClick();
  assert.equal(states[4],true,'a saved signature stops retry submission');
  if(confirmed){assert.match(states[3],/已确认/);assert.match(messages[0],/已保存并确认/);}
  else {assert.match(states[3],/待.*核对确认/);assert.doesNotMatch(states[3],/已确认|已提交润丰/);assert.match(messages[0],/待核对确认/);}
 }
});
