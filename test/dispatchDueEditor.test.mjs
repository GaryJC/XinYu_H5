import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {canEditDispatchDue} from '../shared/dispatchDuePolicy.mjs';
const require=createRequire(import.meta.url);
const compile=file=>ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const labels={};vm.runInNewContext(compile('../client/src/features/dispatch/dispatchLabels.ts'),{exports:labels,require,Date});
const code=compile('../client/src/features/dispatch/TaskDueDateEditor.tsx');
function setup(role='advisor') {
  let index=0;const slots=[],calls=[];
  const user={id:role,name:role,role,shopId:'shop',active:true};
  const c={detail:{task:{orderId:'order',shopId:'shop',orderStatus:'已委托',stage:'维修中',version:1,dueAt:'2026-10-22T08:00:00Z'}},busy:false,error:'',async act(input){calls.push(input);return true;}};
  const exports={};
  vm.runInNewContext(code,{exports,Date,require(name){
    if(name==='react')return {useState(value){const i=index++;if(!(i in slots))slots[i]=value;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},useRef(value){const i=index++;if(!(i in slots))slots[i]={current:value};return slots[i];},useEffect(){}};
    if(name==='antd')return{Alert:'Alert',Button:'Button',Input:'Input'};
    if(name==='lucide-react')return{PencilLine:'Icon'};
    if(name.endsWith('dispatchDuePolicy.mjs'))return{canEditDispatchDue};
    if(name.endsWith('BusinessForm'))return{FormDialog:'FormDialog'};
    if(name==='./dispatchLabels')return labels;
    return require(name);
  }});
  function nodes(node){if(!node||typeof node!=='object')return[];return[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];}
  const render=()=>{index=0;const tree=exports.TaskDueDateEditor({controller:c,user});return nodes(tree);};
  const find=type=>render().find(node=>node.type===type);
  const begin=()=>render().find(node=>node.type==='Button'&&node.props['aria-label']==='编辑预计完工时间').props.onClick();
  return{c,user,calls,render,find,begin};
}
test('editor uses Beijing time, disables unchanged values and sends only the date action',async()=>{
  const h=setup();h.begin();
  assert.equal(h.find('Input').props.value,'2026-10-22T16:00');
  assert.equal(h.find('FormDialog').props.okButtonProps.disabled,true);
  h.find('Input').props.onChange({target:{value:'2026-10-23T00:00'}});
  await h.find('FormDialog').props.onOk();await new Promise(setImmediate);
  assert.equal(h.calls.length,1);
  assert.deepEqual({...h.calls[0]},{action:'update-due',dueAt:'2026-10-22T16:00:00.000Z'});
  assert.equal(h.find('FormDialog').props.open,false);
});
test('stale versions require an explicit reload and do not submit against a refreshed task',async()=>{
  const h=setup('inspector');h.begin();
  h.find('Input').props.onChange({target:{value:'2026-10-23T09:00'}});
  h.c.detail.task={...h.c.detail.task,version:2,dueAt:'2026-10-24T00:00:00Z'};
  assert.equal(h.find('FormDialog').props.okButtonProps.disabled,true);
  await h.find('FormDialog').props.onOk();
  assert.equal(h.calls.length,0);
  const warning=h.render().find(node=>node.type==='Alert'&&node.props.action);
  warning.props.action.props.onClick();
  assert.equal(h.find('Input').props.value,'2026-10-24T08:00');
});
test('failed saves retain the chosen time and cancellation never submits',async()=>{
  const h=setup();h.begin();h.c.act=async input=>{h.calls.push(input);h.c.error='网络中断';return false;};
  h.find('Input').props.onChange({target:{value:'2026-10-23T10:00'}});
  await h.find('FormDialog').props.onOk();await new Promise(setImmediate);
  assert.equal(h.find('FormDialog').props.open,true);
  assert.equal(h.find('Input').props.value,'2026-10-23T10:00');
  assert.ok(h.render().some(node=>node.type==='Alert'&&node.props.title==='网络中断'));
  h.find('FormDialog').props.onCancel();assert.equal(h.calls.length,1);
});
test('workers do not see an editor and completed tasks lose the editing entrypoint',()=>{
  assert.ok(!setup('technician').render().some(node=>node.type==='Button'));
  const h=setup('manager');h.c.detail.task.stage='维修完成';
  assert.ok(!h.render().some(node=>node.type==='Button'));
});
