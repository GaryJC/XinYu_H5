import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {filterCompletedProjects} from '../server/domain/technicianCompletedProjects.mjs';
const compiled=ts.transpileModule(readFileSync(new URL('../client/src/features/dispatch/dispatchApi.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const exports={};
vm.runInNewContext(compiled,{exports,URLSearchParams,require:()=>({request:url=>url})});
const query=filters=>new URL(exports.dispatchApi.myCompletedProjects('2026-11',1,filters),'http://localhost').searchParams;
test('clearing completion dates omits absent parameters and restores monthly query',()=>{
 for(const filters of [{from:undefined,to:undefined},{sort:undefined},{from:'',to:'',sort:'completed-asc'}]){
  const params=query(filters);
  assert.equal(params.has('from'),false);assert.equal(params.has('to'),false);
  assert.equal(params.get('month'),'2026-11');
  assert.doesNotThrow(()=>filterCompletedProjects([],Object.fromEntries(params)));
 }
});
test('one-sided completion ranges and sort survive transport without undefined values',()=>{
 for(const filters of [{from:'2026-11-01',to:undefined},{from:undefined,to:'2026-11-05',sort:'completed-desc'}]){
  const params=query(filters);
  assert.equal([...params.values()].includes('undefined'),false);
  for(const [key,value] of Object.entries(filters))if(value)assert.equal(params.get(key),value);
  assert.doesNotThrow(()=>filterCompletedProjects([],Object.fromEntries(params)));
 }
});
