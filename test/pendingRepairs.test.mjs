import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingName,pendingLegacyItems,mergePendingWriteback,validatePendingText} from '../server/domain/pendingRepairs.mjs';
import {makeWritebackSnapshot,validateWritebackSnapshot} from '../server/domain/repairWriteback.mjs';
import {buildLegacySyncPayload} from '../server/repositories/legacySyncOutboxRepository.mjs';
const pending=(id,state='pending',scheduled=false)=>({id:String(id),itemId:id,name:`项目${id}`,reason:'公司确认',state,scheduled,history:[]});
test('first pull includes pending items, omits declined items, and never mutates original names',()=>{
 const items=[pending(-1),pending(-2,'declined'),pending(-3,'approved')];
 const out=buildLegacySyncPayload({eventId:'e',revision:1,eventType:'created',order:{id:'o',repairItems:[{id:1,name:'正常维修'}],pendingRepairs:items}});
 assert.deepEqual(out.order.repairItems.map(i=>i.name),['正常维修','【待定】项目-1','【待定】项目-3']);
 assert.equal(items[0].name,'项目-1');assert.equal(pendingName('【待定】【待定】更换轮胎'),'【待定】更换轮胎');
});
test('writeback removes prefix only for approved and inspected items, preserves all other pending rows',()=>{
 const list=[pending(-1),pending(-2,'approved',true),pending(-3,'approved',true),pending(-4,'declined')];
 const result=mergePendingWriteback([{id:1,name:'正常维修',status:'已完工'},{id:-2,name:'项目-2',status:'待开工'},{id:-3,name:'项目-3',status:'已完工'},{id:-4,name:'项目-4'}],list);
 assert.equal(result.find(i=>i.id===-1).name,'【待定】项目-1');assert.equal(result.find(i=>i.id===-2).name,'【待定】项目-2');
 assert.equal(result.find(i=>i.id===-3).name,'项目-3');assert.ok(!result.some(i=>i.id===-4));assert.equal(result.length,4);
});
test('unassigned pending rows are valid for Runfeng but finished work still requires a bound worker',()=>{
 const snapshot=makeWritebackSnapshot({orderId:'o',plate:'鲁B12345'},mergePendingWriteback([], [pending(-1)]),[]);
 assert.doesNotThrow(()=>validateWritebackSnapshot(snapshot));assert.equal(snapshot.items[0].employeeCode,null);
 assert.throws(()=>validateWritebackSnapshot(makeWritebackSnapshot({plate:'鲁B12345'},[{id:1,name:'维修完成'}],[])),/负责人/);
 assert.throws(()=>validatePendingText('','项目名称'),/不能为空/);
 assert.throws(()=>validateWritebackSnapshot({...snapshot,items:[{...snapshot.items[0],name:'字'.repeat(101)}]}),/字段长度/);
});

test('progress follows actual items across rounds without persisting customer state changes',async()=>{
 const {pendingRepairProgress}=await import('../server/domain/pendingRepairs.mjs');
 const items=[pending(-1,'approved',true),pending(-2,'approved',true),pending(-3,'approved',true),pending(-4)];
 const rounds=[{round:0,task:{items:[{id:-1,status:'已完工'},{id:-2,status:'已完工'}]}}];
 const current={repairRound:1,stage:'待接单',items:[{id:-2,status:'待开工'}]};
 const result=pendingRepairProgress(items,current,rounds);
 assert.equal(result[0].progress,'检验通过');assert.equal(result[0].repairRound,0);
 assert.equal(result[1].progress,'待接单');assert.equal(result[1].repairRound,1);
 assert.equal(result[2].progress,'进度待核对');assert.equal(result[3].progress,undefined);
 assert.ok(items.every(item=>item.progress===undefined));
 for(const [status,stage,expected] of [['维修中','维修中','维修中'],['待检验','维修中','待检验'],['已完工','暂停','检验通过'],['维修中','暂停','暂停']]) {
  assert.equal(pendingRepairProgress(items,{...current,stage,items:[{id:-2,status}]},rounds)[1].progress,expected);
 }
});
test('same-name pending projects remain distinct while approved completed IDs replace placeholders',()=>{
 const p=[{...pending(-1,'approved',true),name:'同名项目'},{...pending(-2),name:'同名项目'}];
 const result=mergePendingWriteback([{id:1,name:'原项目',status:'已完工'},{id:-1,name:'同名项目',status:'已完工'}],p);
 assert.equal(result.length,3);assert.equal(new Set(result.map(i=>i.id)).size,3);
 assert.equal(result.find(i=>i.id===-1).pendingConfirmation,undefined);
 assert.equal(result.find(i=>i.id===-2).name,'【待定】同名项目');
});
