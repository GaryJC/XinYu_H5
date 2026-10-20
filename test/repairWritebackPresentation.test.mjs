import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const source=readFileSync(new URL('../client/src/features/dispatch/repairWritebackPresentation.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
const {repairWritebackPresentation:present}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const job={id:'1',repairRound:0,status:'synced',enabled:true,error:'',attempts:1,createdAt:'2026-10-18'};
test('a returned current round never inherits a previous successful writeback',()=>{
 const result=present({repairRound:1,stage:'维修中',rejectedItemIds:[4]},job);
 assert.equal(result.type,'info');assert.match(result.title,/全部检验通过后才写入/);assert.equal(result.canRetry,false);
 assert.equal(present({repairRound:1,stage:'待检验'},job),undefined);
 assert.equal(present({repairRound:1,stage:'维修完成'},job),undefined);
});
test('only a successful writeback of the completed current round shows success',()=>{
 assert.equal(present({repairRound:1,stage:'维修完成'},{...job,repairRound:1}).type,'success');
 assert.equal(present({repairRound:1,stage:'维修中'},{...job,repairRound:1}),undefined);
 assert.equal(present({stage:'维修完成'},job).type,'success');
});
test('returns show the inspection gate even before any writeback exists',()=>{
 const resubmitted=present({repairRound:1,stage:'待检验',rejectedItemIds:[4]});
 assert.equal(resubmitted.type,'info');assert.match(resubmitted.title,/返工已提交/);assert.doesNotMatch(resubmitted.title,/有退回项目/);
 assert.equal(present({repairRound:1,stage:'待检验'}),undefined);
});
test('historical failures remain actionable and explicitly identify the historical round',()=>{
 const result=present({repairRound:2,stage:'维修中'},{...job,repairRound:1,status:'failed',error:'断线'});
 assert.equal(result.type,'warning');assert.match(result.title,/返工第 1 轮/);assert.equal(result.description,'断线');assert.equal(result.canRetry,true);
});


test('manually recovered internal jobs are not mislabeled as outsourced',()=>{
 const result=present({stage:'维修完成'},{...job,status:'manual',error:'管理员 Gary 确认人工登记：已核对'});
 assert.match(result.title,/已确认人工登记/);assert.ok(!result.title.includes('外包'));assert.equal(result.canRetry,false);
});
