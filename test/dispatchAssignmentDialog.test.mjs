import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';

function setup(mode='internal') {
  let cursor=0;
  const state=[],calls=[],people=[{id:'one',name:'员工一'},{id:'two',name:'员工二'}];
  const react={useState(initial){const index=cursor++;if(!(index in state))state[index]=initial;return [state[index],next=>{state[index]=typeof next==='function'?next(state[index]):next;}];}};
  const rows=[{id:1,name:'检查'},{id:2,name:'维修'}];
  const task={version:1,stage:'待派工',executionMode:mode,items:rows,technicianIds:['old-team-member']};
  const draft={rows,change(next){draft.rows=next;},stale:false};
  const modules={
    react,'react/jsx-runtime':jsx,
    antd:{Alert:'Alert',Button:'Button',Checkbox:'Checkbox',Form:Object.assign('Form',{Item:'FormItem'}),Input:Object.assign(()=>null,{TextArea:'TextArea'}),InputNumber:'InputNumber',Radio:{Group:'RadioGroup'},Select:'Select'},
    './useDispatchProjectDraft':{useDispatchProjectDraft:()=>draft},
    './useProjectReassignment':{useProjectReassignment:()=>({})},
    './inspectionReview':{summarizeInspection:()=>({rejectedItemIds:[],deferredItemIds:[]})},
    './dispatchLabels':{actionLabels:{assign:'指派维修工'},localDateTime:()=> '2026-12-31T18:00',personDisplayName:p=>p.name},
    '../../shared/ui/BusinessForm':{FormDialog:'FormDialog',FormSection:'FormSection'},
    './InspectionItems':{InspectionItems:'InspectionItems'},
    './RepairItemsEditor':{RepairItemsEditor:'RepairItemsEditor'},
    './ProjectReassignmentFields':{ProjectReassignmentFields:'ProjectReassignmentFields'},
    './DispatchExecutionFields':{DispatchExecutionFields:'DispatchExecutionFields'},
    './dispatch.css':{}
  };
  const exports={};
  const source=readFileSync(new URL('../client/src/features/dispatch/DispatchActionDialog.tsx',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(compiled,{exports,require:name=>{assert.ok(name in modules,name);return modules[name];}});
  const controller={people:{technicians:people,contractors:[],inspectors:[]},summaries:[],act:async input=>{calls.push(input);return true;}};
  function render(){cursor=0;return exports.DispatchActionDialog({action:'assign',task,controller,onClose(){}});}
  function find(tree,predicate){if(!tree)return [];if(Array.isArray(tree))return tree.flatMap(n=>find(n,predicate));if(typeof tree!=='object')return [];return [...(predicate(tree)?[tree]:[]),...find(tree.props?.children,predicate)];}
  return {render,find,draft,calls,people};
}
test('initial assignment directly offers all technicians and submits only unique project owners',async()=>{
  const h=setup();let tree=h.render();
  assert.equal(h.find(tree,n=>n.props?.['aria-label']==='维修工').length,0);
  const editor=h.find(tree,n=>n.type==='RepairItemsEditor')[0];
  assert.deepEqual(editor.props.technicians,h.people);
  editor.props.onChange([{id:1,name:'检查',responsibleId:'two'},{id:2,name:'维修',responsibleId:'one'},{name:'增修',responsibleId:'two'}]);
  tree=h.render();tree.props.onOk();await Promise.resolve();
  assert.equal(h.calls.length,1);
  assert.deepEqual(Array.from(h.calls[0].technicianIds),['two','one']);
  assert.equal(h.calls[0].repairItems.length,3);
  h.draft.change([{id:1,name:'检查',responsibleId:'one'}]);
  h.render().props.onOk();await Promise.resolve();
  assert.deepEqual(Array.from(h.calls[1].technicianIds),['one']);
});
test('initial assignment rejects a missing project owner without using the old team',()=>{
  const h=setup();h.render().props.onOk();assert.equal(h.calls.length,0);
  assert.ok(h.find(h.render(),n=>n.type==='Alert'&&n.props.title.includes('逐项选择负责人')).length);
});
test('outsourced initial assignment does not require internal project owners',()=>{
  const h=setup('outsourced');const tree=h.render();
  assert.equal(h.find(tree,n=>n.type==='RepairItemsEditor')[0].props.showResponsibilities,false);
  tree.props.onOk();assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].technicianIds.length,0);
});
