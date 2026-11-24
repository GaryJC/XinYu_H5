import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as roles from '../shared/roles.mjs';
import * as ownership from '../shared/orderOwnership.mjs';
import * as legacyValidation from '../shared/legacyInputValidation.mjs';

const compiled=new Map();
function load(file,api={}) {
 if(!compiled.has(file))compiled.set(file,ts.transpileModule(readFileSync(new URL(`../client/src/features/${file}`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText);
 const exports={};
 vm.runInNewContext(compiled.get(file),{exports,Error,require(name){
  if(name.endsWith('roles.mjs'))return roles;
  if(name.endsWith('orderOwnership.mjs'))return ownership;
  if(name.endsWith('legacyInputValidation.mjs'))return legacyValidation;
  if(name==='react')return {useState:initial=>[initial,()=>{}],useRef:initial=>({current:initial}),useEffect(){}};
  if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'Fragment'};
  if(name==='antd')return {Alert:'Alert',Button:'Button',Modal:{},Input:'Input'};
  if(name.endsWith('workOrderApi'))return {workOrderApi:api};
  if(name.endsWith('useActionFeedback'))return {useActionFeedback:()=>({success(){},warning(){},error(){}})};
  if(name.endsWith('AuthenticatedImage'))return {AuthenticatedImage:'Image'};
  if(name==='./useSignatureReview')return {useSignatureReview:()=>({busy:false,error:'',confirm(){},resign(){}})};
  throw new Error(`Unexpected import ${name}`);
 }});
 return exports;
}
const owner={id:'owner',name:'原姓名',role:'advisor',active:true,shopId:'s'};
const order={id:'o',shop:{id:'s'},advisor:'原姓名',advisorUserId:'owner',status:'已委托',legacySyncStatus:'synced',legacySyncRevision:1,customerVehicleEditEnabled:true,customerVehicleLinkComplete:true,customer:{},signatures:{},customerSignatureReview:{state:'pending'}};
const accounts=[
 ['same name, different ID',{...owner,id:'namesake'},false],
 ['same ID, changed name',{...owner,name:'新姓名'},true],
 ['manager',{...owner,id:'manager',name:'管理员',role:'manager'},true],
 ['different shop',{...owner,shopId:'other'},false],
];
for(const [label,user,allowed] of accounts)test(`${label}: paper drafts, legacy refresh, contact editing and signature confirmation agree`,async()=>{
 const draft={...order,status:'草稿',paperOrder:{mode:'dingtalk'}};
 const paper=load('work-orders/hooks/usePaperOrderResolution.ts').usePaperOrderResolution(draft,user,()=>{},()=>{});
 assert.equal(paper.canProcess,allowed);
 const calls=[],refresh=load('workbench/useArchiveLegacyRefresh.ts',{refreshFromRunfeng:async id=>{calls.push(id);return order;}}).useArchiveLegacyRefresh(user,()=>{});
 assert.equal(refresh.canRefresh(order),allowed);await refresh.refresh([order]);assert.equal(calls.length,allowed?1:0);
 assert.equal(load('customer-vehicle-update/useCustomerVehicleEditor.ts').useCustomerVehicleEditor(order,user,()=>{}).canEdit,allowed);
 const review=load('signature/SignatureReview.tsx').SignatureReview({order,user,onUpdated(){}});
 const children=[review.props.children].flat(Infinity);
 assert.equal(children.filter(child=>child?.type==='Button').length,allowed?2:0);
});
test('legacy orders retain name ownership and pending paper intake retains its shared advisor permission',()=>{
 const legacy={...order,advisorUserId:undefined},namesake={...owner,id:'namesake'};
 assert.equal(load('workbench/useArchiveLegacyRefresh.ts').useArchiveLegacyRefresh(namesake,()=>{}).canRefresh(legacy),true);
 assert.equal(load('customer-vehicle-update/useCustomerVehicleEditor.ts').useCustomerVehicleEditor(legacy,namesake,()=>{}).canEdit,true);
 const pending={...order,status:'待处理纸质委托书',paperOrder:{mode:'pending'}};
 const paper=load('work-orders/hooks/usePaperOrderResolution.ts');
 assert.equal(paper.usePaperOrderResolution(pending,namesake,()=>{},()=>{}).canProcess,true);
 assert.equal(paper.usePaperOrderResolution(pending,{...namesake,role:'technician'},()=>{},()=>{}).canProcess,false);
 assert.equal(paper.usePaperOrderResolution(pending,{...owner,role:'technician',name:'新姓名'},()=>{},()=>{}).canProcess,true);
});
