import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const code=ts.transpileModule(readFileSync('client/src/features/workbench/TodoOverview.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function render(canApprove,photoApprovalCount){
 let index=0;const exports={},opened=[];
 vm.runInNewContext(code,{exports,require(name){
  if(name==='react')return {useEffect(){},useState(value){const i=index++;return [i===2?2:value,()=>{}];}};
  if(name==='antd')return {Alert:'Alert',Button:'Button',Drawer:'Drawer'};
  if(name==='lucide-react')return new Proxy({},{get:()=> 'Icon'});
  if(name.includes('vehicleTripApi'))return {};
  return require(name);
 }});
 const tree=exports.TodoOverview({counters:[],canApprove,canApprovePhotos:true,photoApprovalCount,onTodo:v=>opened.push(v),onApprovals:()=>opened.push('vehicle')});
 const walk=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(walk):[node,...walk(node.props?.children)];
 return {nodes:walk(tree),opened};
}
test('manager overview sums vehicle and photo applications and links to the approval filter',()=>{
 const h=render(true,3);const metric=h.nodes.find(n=>n.props?.['aria-label']==='查看待审批事项');
 assert.equal(metric.props.children[1].props.children[0],5);
 h.nodes.find(n=>n.props?.['aria-label']==='查看无维修照片审批待审批事项').props.onClick();
 assert.deepEqual(h.opened,['无照片待审批']);
});
test('advisor overview exposes photo approvals without granting vehicle approval access',()=>{
 const h=render(false,3);
 assert.equal(h.nodes.find(n=>n.props?.['aria-label']==='查看待审批事项').props.children[1].props.children[0],3);
 assert.equal(h.nodes.some(n=>n.props?.['aria-label']==='查看出车申请待审批事项'),false);
});
test('an unavailable photo count is not displayed as zero',()=>{
 const h=render(true,undefined);
 assert.equal(h.nodes.find(n=>n.props?.['aria-label']==='查看待审批事项').props.children[1].props.children[0],'—');
});
