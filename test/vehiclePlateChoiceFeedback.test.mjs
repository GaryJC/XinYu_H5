import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=readFileSync(new URL('../client/src/features/vehicle-identity/VehicleIdentityRecognition.tsx',import.meta.url),'utf8').replaceAll('import.meta.env.DEV','false');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
function setup(history){
 const slots=[];let cursor=0;const selected=[];const exports={};
 const jsx=(type,props)=>({type,props});
 vm.runInNewContext(compiled,{exports,require(name){
  if(name==='react')return {useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],v=>{slots[index]=typeof v==='function'?v(slots[index]):v;}];}};
  if(name==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'fragment'};
  return new Proxy({},{get:(_,key)=>key});
 }});
 const props={recognition:{plate:{status:'未识别'},vin:{status:'未识别'}},history,historyLoading:false,historyError:'',onConfirmPlate:plate=>selected.push(plate)};
 return {selected,render(){cursor=0;return exports.VehicleIdentityRecognition(props);}};
}
function find(node,type){
 if(!node||typeof node!=='object')return [];
 if(Array.isArray(node))return node.flatMap(item=>find(item,type));
 return [...(node.type===type?[node]:[]),...find(node.props?.children,type)];
}
const choices=['鲁B FP121','鲁BFP121'];
test('VIN conflict remains visible inside the choice dialog and after it is dismissed',()=>{
 const message='所选车牌与当前 VIN 不符，请核对车牌或 VIN';
 const h=setup({status:'conflict',plateChoices:choices,message});
 let tree=h.render();const modal=find(tree,'Modal')[0];
 assert.equal(modal.props.open,true);assert.equal(find(modal,'Alert')[0].props.title,message);
 modal.props.onCancel();tree=h.render();
 assert.equal(find(tree,'Modal')[0].props.open,false);
 assert.ok(find(tree,'Alert').some(alert=>alert.props.title===message));
 const reopen=find(tree,'Button').find(b=>b.props.children==='选择润丰车牌');assert.ok(reopen);reopen.props.onClick();
 assert.equal(find(h.render(),'Modal')[0].props.open,true);
});
test('initial choices do not duplicate the title as an error and preserve the exact plate on selection',()=>{
 const h=setup({status:'conflict',plateChoices:choices,message:'请选择润丰档案中的车牌原文'});
 const modal=find(h.render(),'Modal')[0];assert.equal(find(modal,'Alert').length,0);
 for(const b of find(modal,'Button'))b.props.onClick();
 assert.deepEqual(h.selected,choices);
});
