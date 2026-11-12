import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {validatePartsRequirement} from '../server/domain/partsRequirement.mjs';
const require=createRequire(import.meta.url);
const code=ts.transpileModule(readFileSync(new URL('../client/src/features/dispatch/PartsRequirementDialog.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const parts=()=>({mode:'list',items:[{name:'机油',quantity:1,unit:'桶'},{name:'滤芯',quantity:2,unit:'个'}],photoIds:[],referencePhotoIds:['reference']});
function setup(requirement=parts()) {
 let cursor=0,closed=0,checks=0;const slots=[],calls=[];
 const c={busy:false,detail:{task:{orderId:'order',stage:'维修中',technicianIds:['t'],partsRequirement:requirement},files:[]},async act(input){validatePartsRequirement(input.partsRequirement);calls.push(structuredClone(input));return true;}};
 const exports={};
 vm.runInNewContext(code,{exports,require(name){
  if(name==='react')return {useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return [slots[index],next=>{slots[index]=typeof next==='function'?next(slots[index]):next;}];},useEffect(){}};
  if(name==='react/jsx-runtime')return require(name);
  if(name.endsWith('/BusinessForm'))return {FormDialog:'FormDialog'};
  if(name==='antd')return {Alert:'Alert',Button:'Button',Collapse:'Collapse',Input:'Input',InputNumber:'InputNumber',Radio:{Group:'Radio'},Table:'Table'};
  if(name==='@ant-design/icons')return {DeleteOutlined:'Delete',PlusOutlined:'Plus',CheckOutlined:'Check'};
  if(name.endsWith('.css'))return {};
  if(name==='./VehicleNameplatePhotos')return {VehicleNameplatePhotos:'Nameplate',useVehicleNameplateUpload:()=>({async check(){checks++;return true;}})};
  if(name==='./usePartsPhotoAttachments')return {usePartsPhotoAttachments:()=>({uploads:[],uploading:false})};
  if(name==='./dispatchApi')return {dispatchApi:{}};
  const key=name.split('/').at(-1);return {[key]:key};
 }});
 function nodes(node){return !node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];}
 const render=()=>{cursor=0;return nodes(exports.PartsRequirementDialog({controller:c,accepting:false,onClose(){closed++;}}));};
 const find=type=>render().find(node=>node.type===type);
 const remove=index=>{const table=find('Table');const button=table.props.columns.at(-1).render(null,table.props.dataSource[index]);return button;};
 return {c,calls,find,render,remove,closed:()=>closed,checks:()=>checks,async save(){find('FormDialog').props.onOk();await new Promise(setImmediate);}};
}
test('removing one pending line submits the other line unchanged',async()=>{
 const h=setup();h.remove(0).props.onClick();await h.save();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].action,'record-parts');
 assert.deepEqual(h.calls[0].partsRequirement,{...parts(),items:[parts().items[1]]});
 assert.equal(h.checks(),1);assert.equal(h.closed(),1);
});
test('removing the last line submits no-parts without nameplate or lingering reference photos',async()=>{
 const h=setup({...parts(),items:[parts().items[0]]});h.remove(0).props.onClick();
 assert.equal(h.find('Radio').props.value,'none');await h.save();
 assert.deepEqual(h.calls[0].partsRequirement,{mode:'none',items:[],photoIds:[],referencePhotoIds:[]});
 assert.equal(h.checks(),0);assert.equal(h.closed(),1);
});
test('handled lines cannot be removed while a pending line can be removed',async()=>{
 for(const flag of ['preparedAt','issuedAt']) {
  const original=parts();original.items[0][flag]='handled';
  const h=setup(original);assert.equal(h.remove(0).props.disabled,true);h.remove(0).props.onClick();
  assert.equal(h.find('Table').props.dataSource.length,2);
  h.remove(1).props.onClick();await h.save();
  assert.deepEqual(h.calls[0].partsRequirement.items,[original.items[0]]);
  assert.equal(h.calls[0].partsRequirement.mode,'list');
 }
});
test('new empty forms still require a choice; stale edits never submit',async()=>{
 const fresh=setup(null);await fresh.save();assert.equal(fresh.calls.length,0);
 assert.ok(fresh.render().some(node=>node.type==='Alert'&&/请填写配件/.test(node.props.title)));
 const stale=setup();stale.remove(0).props.onClick();stale.c.detail.task.partsRequirement={...parts(),revision:2};
 assert.equal(stale.find('FormDialog').props.okButtonProps.disabled,true);await stale.save();assert.equal(stale.calls.length,0);
});
