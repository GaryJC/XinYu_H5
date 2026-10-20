import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../client/src/features/dispatch/inspectionReview.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
const {summarizeInspection}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const items=[{id:1,status:'待检验'},{id:2,status:'待检验'},{id:3,status:'已完工'}];
test('every pending item needs an explicit inspection decision',()=>{
 assert.equal(summarizeInspection(items,{}).complete,false);
 assert.equal(summarizeInspection(items,{1:'pass'}).complete,false);
 assert.equal(summarizeInspection(items,{1:'pass',2:'pass'}).complete,true);
 assert.deepEqual(summarizeInspection(items,{1:'pass',2:'pass'}).rejectedItemIds,[]);
 assert.equal(summarizeInspection([],{}).complete,false);
});
test('review derives returns only from current pending items and cannot auto-pass new work',()=>{
 const result=summarizeInspection(items,{1:'pass',2:'return',3:'return',99:'return'});
 assert.equal(result.complete,true);assert.deepEqual(result.rejectedItemIds,[2]);assert.equal(result.pending.length,2);
 assert.equal(summarizeInspection([...items,{id:4,status:'待检验'}],{1:'pass',2:'return'}).complete,false);
 assert.deepEqual(summarizeInspection(items.map(i=>i.id===2?{...i,status:'已完工'}:i),{1:'pass',2:'return'}).rejectedItemIds,[]);
});

test('inspection draft renders safely before task data arrives',async()=>{
 const {createElement}=await import('react');const {renderToString}=await import('react-dom/server');
 const hookSource=readFileSync(new URL('../client/src/features/dispatch/useInspectionDraft.ts',import.meta.url),'utf8');
 const compiled=ts.transpileModule(hookSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
  .replace("from 'react'",`from '${import.meta.resolve('react')}'`)
  .replace("from './inspectionReview'",`from 'data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}'`);
 const {useInspectionDraft}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
 function Preview(){const result=useInspectionDraft();assert.equal(result.complete,false);assert.deepEqual(result.choices,{});return createElement('span',null,'loading');}
 assert.equal(renderToString(createElement(Preview)),'<span>loading</span>');
});
