import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as roles from '../shared/roles.mjs';
import * as progress from '../shared/repairProgress.mjs';
import * as eligibility from '../shared/inspectionEligibility.mjs';

// Execute the real detail component and inspection draft hook; unrelated visual
// children are opaque elements, so this fixture never contacts business APIs.
function setup(user,claimedBy) {
  let cursor=0;
  const state=[],calls=[];
  const react={useRef:()=>({current:null}),useState(initial){const index=cursor++;if(!(index in state))state[index]=initial;return [state[index],next=>{state[index]=typeof next==='function'?next(state[index]):next;}];}};
  const modules={react,'react/jsx-runtime':jsx,
    '../../../../shared/roles.mjs':roles,'../../../../shared/repairProgress.mjs':progress,
    '../../../../shared/inspectionEligibility.mjs':eligibility,
    antd:Object.fromEntries(['Alert','Button','Card','Collapse','Descriptions','Space','Tag'].map(name=>[name,name])),
    './useDispatchProjectFocus':{useDispatchProjectFocus:()=>({current:null})},
    '../../shared/ui/useElementHeight':{useElementHeight:()=>0},
    '../../shared/api/httpClient':{requestBlob:()=>assert.fail('unexpected network')},
    './taskSectionNavigation':{scrollToTaskSection(){}},
    './DispatchExecutionFields':{executionLabels:{internal:'店内维修'},executionTextFields:{},executionTimeFields:{}},
  };
  for(const [path,names] of Object.entries({
    './RepairPhotoWaiverPanel':['PhotoWaiverRecord'],'../notifications/NotificationRecords':['NotificationRecords'],
    '../../shared/ui/ActionHistory':['ActionHistory'],'../../shared/ui/LoadingState':['LoadingState'],
    './TaskTechniciansEditor':['TaskTechniciansEditor'],'../pending-repairs/PendingRepairsPanel':['PendingRepairsPanel'],
    './TaskDueDateEditor':['TaskDueDateEditor'],'./RepairWritebackStatus':['RepairWritebackStatus'],
    './DispatchProjectsEditor':['DispatchProjectsEditor'],'./DispatchItemProgressActions':['DispatchItemProgressActions'],
    './RepairProjectChanges':['RepairProjectChanges'],'./InspectionItems':['InspectionItems','PassedInspectionItems'],
    './TaskOverview':['TaskOverview'],'./RepairPhotoPanel':['RepairPhotoPanel'],'./DispatchSheetSummary':['DispatchSheetSummary'],
    './PartsRequirementDialog':['PartsRequirementDialog'],'./PartsRequirementSummary':['PartsRequirementSummary'],
    './TaskPartsSummary':['TaskPartsSummary'],'./RepairRoundHistory':['RepairRoundHistory'],
    '../../shared/ui/AuthenticatedImage':['AuthenticatedImage'],'./DispatchActionDialog':['DispatchActionDialog'],
  }))modules[path]=Object.fromEntries(names.map(name=>[name,name]));
  const compile=name=>{
    const exports={};
    const source=readFileSync(new URL(`../client/src/features/dispatch/${name}.tsx`,import.meta.url),'utf8');
    evaluate(source,exports);return exports;
  };
  function evaluate(source,exports) {
    const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    vm.runInNewContext(compiled,{exports,require:name=>{if(name.endsWith('.css'))return {};assert.ok(name in modules,name);return modules[name];}});
  }
  for(const name of ['inspectionReview','useInspectionDraft']){
    const exports={};evaluate(readFileSync(new URL(`../client/src/features/dispatch/${name}.ts`,import.meta.url),'utf8'),exports);modules[`./${name}`]=exports;
  }
  modules['./dispatchLabels']={actionLabels:{'claim-inspection':'开始检验','send-review':'发送回审','reassign-inspection':'重新分配检验'},displayTime:()=>'',taskStatusLabel:t=>t.stage,notificationLabels:{},dispatchEventLabel:()=>''};
  const {DispatchTaskDetail}=compile('DispatchTaskDetail');
  const task={orderId:'o',shopId:'s',plate:'HB11035',dispatchNo:'A67673',stage:'待检验',orderStatus:'待结算',executionMode:'internal',version:2,repairRound:1,
    technicianIds:['worker'],participantIds:[user.id,'worker'],inspectorId:claimedBy,inspectorName:claimedBy,
    items:[{id:1,name:'追加维修',status:'待检验',responsibleId:'worker',responsibleName:'维修工'}]};
  const controller={manager:roles.hasAnyRole(user,['manager','advisor']),inspectionLead:true,detail:{task,events:[],notifications:[],files:[]},people:{inspectors:[user],technicians:[],contractors:[]},busy:false,act:async request=>calls.push(request),setError:message=>assert.fail(message)};
  const render=()=>{cursor=0;return DispatchTaskDetail({controller,user});};
  return {render,calls,task};
}
function find(tree,predicate){if(!tree)return [];if(Array.isArray(tree))return tree.flatMap(node=>find(node,predicate));if(typeof tree!=='object')return [];return [...(predicate(tree)?[tree]:[]),...find(tree.props?.children,predicate)];}
const buttons=tree=>find(tree,node=>node.type==='Button');
const person=role=>({id:'operator',name:'原外包经办人',role,roles:[role],active:true,shopId:'s'});
for(const role of ['inspector','manager'])test(`${role} with historical participation can claim and choose inspection results`,async()=>{
  const unclaimed=setup(person(role));let tree=unclaimed.render();
  const claim=buttons(tree).find(button=>button.props.children==='开始检验');assert.ok(claim);
  assert.equal(find(tree,node=>node.type==='InspectionItems')[0].props.disabled,true);
  await claim.props.onClick();assert.equal(unclaimed.calls[0].action,'claim-inspection');
  const claimed=setup(person(role),'operator');tree=claimed.render();
  const items=find(tree,node=>node.type==='InspectionItems')[0];assert.equal(items.props.disabled,false);
  items.props.onChange(1,'pass');tree=claimed.render();
  const submit=buttons(tree).find(button=>String(button.props.children).startsWith('提交检验结果'));assert.ok(submit);assert.equal(submit.props.disabled,false);
  submit.props.onClick();tree=claimed.render();
  const dialog=find(tree,node=>node.type==='DispatchActionDialog')[0];assert.equal(dialog.props.action,'inspect');assert.equal(dialog.props.inspectionReview.choices[1],'pass');
});
for(const role of ['advisor','technician'])test(`${role} without inspection permission has no claim or result submission`,()=>{
  const {render}=setup(person(role));const tree=render();
  assert.ok(!buttons(tree).some(button=>button.props.children==='开始检验'||String(button.props.children).startsWith('提交检验结果')));
  assert.equal(find(tree,node=>node.type==='InspectionItems')[0].props.disabled,true);
});
test('ordinary inspector cannot submit another inspector claim or use revoked membership',()=>{
  for(const [user,claim] of [[person('inspector'),'someone-else'],[{...person('inspector'),inspectorRoleMember:false},undefined]]){
    const tree=setup(user,claim).render();assert.equal(find(tree,node=>node.type==='InspectionItems')[0].props.disabled,true);
    assert.ok(!buttons(tree).some(button=>button.props.children==='开始检验'||String(button.props.children).startsWith('提交检验结果')));
  }
});
