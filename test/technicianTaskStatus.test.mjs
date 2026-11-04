import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire,Module} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {applyDispatchAction} from '../server/domain/dispatchPolicy.mjs';
import {canStartRepairWithParts,hasPendingInspection} from '../shared/repairProgress.mjs';

const cache=new Map();
function load(filename) {
  if(cache.has(filename))return cache.get(filename).exports;
  const mod=new Module(filename),require=createRequire(filename);
  cache.set(filename,mod);mod.filename=filename;mod.paths=Module._nodeModulePaths(dirname(filename));
  mod.require=name=>{
    if(name.endsWith('.css'))return {};
    if(name.endsWith('/AuthenticatedImage'))return {AuthenticatedImage:({alt})=>React.createElement('img',{alt})};
    if(name.startsWith('.')) {
      const base=resolve(dirname(filename),name),local=[base,base+'.tsx',base+'.ts'].find(existsSync);
      if(local&&/\.tsx?$/.test(local))return load(local);
    }
    return require(name);
  };
  mod._compile(ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,filename);
  return mod.exports;
}
const client=file=>load(fileURLToPath(new URL(`../client/src/features/dispatch/${file}`,import.meta.url)));
const {technicianTaskStatus:status}=client('technicianTaskStatus.ts');
const {taskStatusLabel}=client('dispatchLabels.ts');
const {personalTask}=client('individualRepair.ts');
const {technicianPrimaryAction}=client('technicianPrimaryAction.ts');
const {TechnicianTaskCard}=client('TechnicianTaskCard.tsx');
const {TaskPartsSummary}=client('TaskPartsSummary.tsx');
const a={id:'a',name:'维修甲',role:'technician',shopId:'s',active:true},b={...a,id:'b',name:'维修乙'};
const warehouse={...a,id:'w',role:'warehouse'},manager={...a,id:'m',role:'manager'};
const now='2026-11-04T04:00:00Z';
const part=name=>({name,quantity:1,unit:'个'});
const base=()=>({orderId:'o',shopId:'s',orderStatus:'维修中',stage:'待开工',version:1,acceptedAt:'accepted',technicianIds:['a','b'],technicianId:'a',
  partsRequests:[{ownerId:'a',ownerName:a.name,mode:'list',items:[part('滤芯'),part('刹车片')],photoIds:[]},{ownerId:'b',ownerName:b.name,mode:'list',items:[part('皮带')],photoIds:[]}],
  items:[{id:1,name:'保养',status:'待开工',responsibleId:'a',responsibleName:a.name},{id:2,name:'检查',status:'待开工',responsibleId:'b',responsibleName:b.name}]});
const act=(task,actor,action,extra={})=>applyDispatchAction(task,{action,expectedVersion:task.version,requestId:'role-status',...extra},actor,[a,b,warehouse,manager],now);
const partial=()=>act(base(),warehouse,'confirm-parts',{partsOwnerId:'a',partsPreparation:[{index:0,recipientId:'a'}]});
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));

test('partial personal preparation shows working only for its owner, while retaining the order and start gates',()=>{
  const task=partial(),before=structuredClone(task);
  assert.equal(status(task,'a'),'正在维修');assert.equal(status(task,'b'),'待开工');assert.equal(taskStatusLabel(task),'正在维修');
  assert.match(render(TechnicianTaskCard,{task,userId:'a',onOpen(){}}),/>部分备齐</);
  const card=render(TechnicianTaskCard,{task,userId:'b',onOpen(){}});
  assert.match(card,/>待开工</);assert.match(card,/>待备料</);assert.doesNotMatch(card,/>正在维修</);
  assert.equal(canStartRepairWithParts(task,'b'),false);
  assert.equal(technicianPrimaryAction(personalTask(task,'a'),false,canStartRepairWithParts(task,'a')),undefined);
  assert.equal(technicianPrimaryAction(personalTask(task,'b'),false,canStartRepairWithParts(task,'b')),undefined);
  assert.deepEqual(task,before);
});

test('a personal submission becomes pending inspection and can pass while the coworker still waits',()=>{
  const ready=act(partial(),warehouse,'confirm-parts',{partsOwnerId:'a',partsPreparation:[{index:1,recipientId:'a'}]});
  const submitted=act(ready,a,'submit-order');
  assert.equal(status(submitted,'a'),'待检验');assert.equal(status(submitted,'b'),'待开工');assert.equal(taskStatusLabel(submitted),'正在维修');
  assert.equal(hasPendingInspection(submitted),true);
  assert.doesNotMatch(render(TechnicianTaskCard,{task:submitted,userId:'a',onOpen(){}}),/等待其他项目/);
  const passed=act(submitted,manager,'inspect');
  assert.equal(status(passed,'a'),'维修完成');assert.equal(status(passed,'b'),'待开工');assert.equal(taskStatusLabel(passed),'正在维修');
});

test('pauses, review, acceptance, single-worker and outsourced workflows retain their status',()=>{
  const task=partial();
  assert.equal(status({...task,workerPauses:{a:{resumeStage:'维修中'}}},'a'),'暂停');
  assert.equal(status({...task,workerPauses:{a:{resumeStage:'维修中'}}},'b'),'待开工');
  for(const stage of ['暂停','回审','待接单','维修完成'])assert.equal(status({...task,stage},'b'),taskStatusLabel({...task,stage}));
  assert.equal(status({...task,stage:'回审',workerPauses:{a:{resumeStage:'回审'}}},'a'),'暂停');
  assert.equal(status({...task,executionMode:'outsourced'},'b'),'正在维修');
  assert.equal(status({...task,technicianIds:['b'],partsRequests:undefined},'b'),'正在维修');
  assert.equal(status({...task,items:[]},'b'),'正在维修');
});

test('returned work waits to start, mixed active work stays working and legacy completion still needs submission',()=>{
  const task=partial();
  task.items.push({...task.items[0],id:3,status:'待检验'});
  assert.equal(status(task,'a'),'正在维修');
  task.items[0].status='待开工';
  assert.equal(status(task,'a'),'待开工');
  task.items[0].status='待检验';
  assert.equal(status(task,'a'),'正在维修');
  assert.equal(technicianPrimaryAction(personalTask(task,'a')),undefined);
  task.workerSubmissions={a:{at:now}};
  assert.equal(status(task,'a'),'待检验');
});

test('manager and inspector parts summaries retain both personal requests and shared material',()=>{
  const task=partial(),personal=render(TaskPartsSummary,{task});
  assert.match(personal,/维修甲 · 配件/);assert.match(personal,/部分备齐/);assert.match(personal,/刹车片/);
  assert.match(personal,/维修乙 · 配件/);assert.match(personal,/待仓库备料/);assert.match(personal,/皮带/);
  assert.doesNotMatch(personal,/尚未登记/);
  task.partsRequirement={mode:'list',items:[part('共用辅料')],photoIds:[]};
  const shared=render(TaskPartsSummary,{task});
  for(const text of ['共同配件','共用辅料','维修甲 · 配件','维修乙 · 配件'])assert.ok(shared.includes(text));
  assert.match(render(TaskPartsSummary,{task:{...task,executionMode:'outsourced'}}),/历史配件申请 · 维修甲/);
  assert.match(render(TaskPartsSummary,{task:{...task,partsRequirement:undefined,partsRequests:[]}}),/尚未登记/);
});
