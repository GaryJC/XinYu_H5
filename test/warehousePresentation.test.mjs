import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
async function sourceModule(name) {
 const source=readFileSync(new URL(`../client/src/features/dispatch/${name}.ts`,import.meta.url),'utf8');
 const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
 return import(`data:text/javascript;base64,${Buffer.from(outputText.replace("from '../../../../shared/repairCompletion.mjs'",`from '${new URL('../shared/repairCompletion.mjs',import.meta.url).href}'`)).toString('base64')}`);
}
const {createVehiclePartsHistoryCache}=await sourceModule('vehiclePartsHistoryCache');
const {dispatchEventLabel}=await sourceModule('dispatchLabels');
test('history cache reuses requests across reopen, expires and permits explicit refresh',async()=>{
 let now=0,calls=0;
 const load=createVehiclePartsHistoryCache(()=>now),fetch=async()=>({status:'found',items:[],call:++calls});
 const first=load('session/order',fetch),duplicate=load('session/order',fetch);
 assert.equal(first,duplicate);assert.equal((await first).call,1);
 assert.equal((await load('session/order',fetch)).call,1);
 assert.equal((await load('session/order',fetch,true)).call,2);
 now=600001;assert.equal((await load('session/order',fetch)).call,3);
 assert.equal((await load('other-session/order',fetch)).call,4);
 assert.equal((await load('session/other-order',fetch)).call,5);
});
test('failed history loads can retry; empty history is cached and memory is bounded',async()=>{
 const load=createVehiclePartsHistoryCache();let calls=0;
 await assert.rejects(load('bad',async()=>{throw new Error('offline');}),/offline/);
 const empty=async()=>{calls++;return {status:'no_history',items:[]};};
 await load('bad',empty);await load('bad',empty);assert.equal(calls,1);
 for(let i=0;i<31;i++)await load(`order-${i}`,empty);
 await load('bad',empty);assert.equal(calls,33);
});
test('supplement batch event snapshots retain distinct labels after later requests',()=>{
 const labels={'record-parts':'登记补料','edit-parts':'仓管整理补料需求','confirm-parts':'补料完成','issue-parts':'补料出库'};
 for(const [action,label] of Object.entries(labels))assert.equal(dispatchEventLabel({action,detail:{partsRequirement:{batch:2,preparedAt:'ready'}}}),label);
 assert.equal(dispatchEventLabel({action:'record-parts',detail:{partsRequirement:{batch:1}}}),'登记配件需求');
 assert.equal(dispatchEventLabel({action:'confirm-parts',detail:{partsRequirement:{preparedAt:'ready'}}}),'备料完成');
 assert.equal(dispatchEventLabel({action:'issue-parts',detail:{partsRequirement:{batch:1}}}),'确认出库');
});
