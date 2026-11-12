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
    if(name.endsWith('/dispatchApi'))return {dispatchApi:{}};
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
const {personalTask,partsController}=client('individualRepair.ts');
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

const {TechnicianTaskDetail}=client('TechnicianTaskDetail.tsx');
const detail=(task,user)=>render(TechnicianTaskDetail,{controller:{detail:{task,files:[],events:[]},people:{technicians:[a,b],contractors:[],inspectors:[manager]},busy:false},user,onPhotoBlocked(){}});

test('details scope returned projects, reasons and start/reinspection labels to the worker',()=>{
 const initial={...base(),stage:'维修中',partsRequests:[{ownerId:'a',mode:'none',items:[]},{ownerId:'b',mode:'none',items:[]}],items:base().items.map(i=>({...i,status:i.responsibleId==='a'?'维修中':'待开工'}))};
 const returned=act(act(initial,a,'submit-order'),manager,'inspect',{rejectedItemIds:[1],reason:'甲项目仍有异响'});
 const own=detail(returned,a),peer=detail(returned,b);
 assert.match(own,/需要返工/);assert.match(own,/甲项目仍有异响/);assert.match(own,/开始返工/);
 assert.doesNotMatch(peer,/需要返工|开始返工|甲项目仍有异响/);assert.match(peer,/开始维修/);
 assert.throws(()=>act(returned,b,'submit-order'),error=>/开工后才能提交/.test(error.message)&&!/返工/.test(error.message));
 const started=act(returned,b,'start-order'),submitted=act(started,b,'submit-order');
 assert.match(detail(submitted,b),/已提交，等待检验员领取/);assert.doesNotMatch(detail(submitted,b),/等待检验员领取复检/);
 const both={...returned,items:returned.items.map(i=>i.responsibleId==='b'?{...i,rejectionReason:'乙项目重新紧固'}:i)};
 assert.equal(personalTask(both,'a').reworkReason,'甲项目仍有异响');assert.equal(personalTask(both,'b').reworkReason,'乙项目重新紧固');
 const legacy={...initial,rework:true,reworkReason:'历史整单返工'};assert.match(detail(legacy,b),/需要返工|历史整单返工/);
 const round={...returned,repairRound:1,roundKind:'rework'};
 assert.match(detail(round,a),/本轮检验退回，请重新维修指定项目/);assert.doesNotMatch(detail(round,b),/本轮检验退回|甲项目仍有异响|开始返工/);
});

test('personal refusal hides only its own controls and reoffer restores personal acceptance',()=>{
 const refused=act({...base(),stage:'待接单',acceptedAt:undefined,partsRequests:undefined},a,'decline',{reason:'甲时间冲突'});
 assert.match(detail(refused,a),/已反馈无法接单/);assert.doesNotMatch(detail(refused,a),/确认接单/);
 assert.match(detail(refused,b),/确认接单/);assert.doesNotMatch(detail(refused,b),/已反馈无法接单|甲时间冲突/);
 const accepted=act(refused,b,'accept',{partsRequirement:{mode:'none'}});
 assert.doesNotMatch(detail(accepted,a),/开始维修|提交本人完工|暂停维修|编辑项目/);
 const offered=act(accepted,manager,'reoffer');assert.match(detail(offered,a),/确认接单/);assert.match(detail(offered,b),/提交本人完工/);
 const material=partsController({detail:{task:personalTask(offered,a.id)}},a.id);assert.equal(material.detail.task.stage,'待接单');
});
