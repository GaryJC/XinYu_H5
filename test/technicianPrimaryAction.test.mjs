import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
import {applyDispatchAction} from '../server/domain/dispatchPolicy.mjs';
const source=readFileSync(new URL('../client/src/features/dispatch/technicianPrimaryAction.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
const {technicianPrimaryAction:primary}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const actor={id:'t',name:'维修工',shopId:'s',active:true,role:'technician'};
const task={orderId:'o',shopId:'s',orderStatus:'维修中',stage:'维修中',version:1,technicianIds:['t'],technicianId:'t',rework:true,rejectedItemIds:[2],partsRequirement:{mode:'none'},items:[{id:1,name:'已通过项目',status:'已完工',startAt:'original',finishAt:'finished',inspectedAt:'inspected',inspectedBy:'i',responsibleId:'t',responsibleName:'维修工'},{id:2,name:'退回项目',status:'待开工',startAt:'old',responsibleId:'t',responsibleName:'维修工'}]};
const act=(t,action)=>applyDispatchAction(t,{action,expectedVersion:t.version,requestId:'returned-start-test'},actor,[actor],'2026-10-18T13:00:00Z');
test('returned items have an explicit start action before completion, even while order stage is working',()=>{
 assert.equal(primary(task),'start-order');
 assert.throws(()=>act(task,'submit-order'),/退回项目尚未开工：退回项目/);
 const started=act(task,'start-order');assert.equal(started.items[1].status,'维修中');assert.equal(started.items[1].startAt,'2026-10-18T13:00:00Z');assert.deepEqual(started.items[0],task.items[0]);
 assert.equal(primary(started),'submit-order');
 const submitted=act(started,'submit-order');assert.equal(submitted.items[1].status,'待检验');assert.deepEqual(submitted.items[0],task.items[0]);assert.equal(submitted.stage,'待检验');
});
test('waiting parts cannot be bypassed and initial unstarted tasks still require explicit start',()=>{
 const withParts={...task,partsRequirement:{mode:'list',items:[]}};
 assert.equal(primary(withParts),undefined);assert.throws(()=>act(withParts,'start-order'),/确认配件备齐/);
 assert.equal(primary({...task,stage:'待开工',rework:false}),'start-order');
 assert.equal(primary({...task,stage:'待检验'}),undefined);
});
