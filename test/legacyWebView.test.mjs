import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {uuid} from '../server/domain/procurement.mjs';
const compile=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
function ids(crypto){const exports={};vm.runInNewContext(compile('../client/src/shared/api/requestId.ts'),{exports,crypto,Uint8Array});return exports;}
const legacyIds=ids({getRandomValues:bytes=>webcrypto.getRandomValues(bytes)});
test('legacy random IDs are UUID v4 and accepted by procurement validation',()=>{
 const values=Array.from({length:500},()=>legacyIds.createRequestId());
 assert.equal(new Set(values).size,500);
 for(const id of values){assert.match(id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);assert.equal(uuid(id),id);}
});
test('modern WebViews retain the native UUID path',()=>{
 const value='b6faec0f-1f0b-4b56-8b27-8ca9ea481c7b';
 assert.equal(ids({randomUUID:()=>value,getRandomValues(){throw Error('fallback used');}}).createRequestId(),value);
});
test('marking a repair pending works without native randomUUID and preserves its identity',()=>{
 const exports={};
 vm.runInNewContext(compile('../client/src/features/work-orders/hooks/useRepairConfirmationRows.ts'),{exports,require(name){if(name.endsWith('requestId'))return legacyIds;throw Error(name);}});
 let draft={repairItems:[{id:42,name:'更换电磁阀'}],pendingRepairs:[]};
 const hook=()=>exports.useRepairConfirmationRows(draft,fn=>draft=fn(draft));
 hook().toggle(hook().rows[0],true);
 assert.equal(draft.repairItems.length,0);assert.equal(draft.pendingRepairs[0].draftItemId,42);assert.equal(uuid(draft.pendingRepairs[0].id),draft.pendingRepairs[0].id);
 hook().toggle(hook().rows[0],false);assert.equal(draft.repairItems[0].id,42);assert.equal(draft.repairItems[0].name,'更换电磁阀');
});
