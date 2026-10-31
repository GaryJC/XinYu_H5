import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
const compile=file=>ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function setup({failFirst=false,brokenCrypto=false,status,gate}={}) {
 const ids={};
 vm.runInNewContext(compile('../client/src/shared/api/requestId.ts'),{exports:ids,Uint8Array,crypto:{getRandomValues(bytes){if(brokenCrypto)throw new Error('random unavailable');return webcrypto.getRandomValues(bytes);}}});
 const slots=[];let cursor=0;const calls=[],feedback=[],exports={};let changed=0;
 const react={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],value=>{slots[index]=value;}];},useRef(initial){const index=cursor++;return slots[index]??={current:initial};},useCallback:fn=>fn,useEffect(){}};
 vm.runInNewContext(compile('../client/src/features/pending-repairs/usePendingRepairs.ts'),{exports,Error,require(id){
  if(id==='react')return react;
  if(id.endsWith('requestId'))return ids;
  if(id.endsWith('useActionFeedback'))return {useActionFeedback:()=>({success:message=>feedback.push(message),error:()=>{}})};
  if(id.endsWith('httpClient'))return {request:async(path,options)=>{
   if(options?.method==='POST'){calls.push(options.body);if(gate)await gate;if(failFirst&&calls.length===1){const error=new Error('network failed');if(status)error.status=status;throw error;}}
   return {items:[{id:'saved',name:'更换电磁阀'}],version:1};
  }};
  throw new Error(id);
 }});
 return {calls,feedback,get changed(){return changed;},render(){cursor=0;return exports.usePendingRepairs('order',()=>changed++);}};
}
const input={action:'add',name:'更换电磁阀',reason:'等待客户确认'};
test('registration works when Android WebView has getRandomValues but no randomUUID',async()=>{
 const s=setup();assert.equal(await s.render().act(input),true);
 assert.match(s.calls[0].requestId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);assert.equal(s.calls[0].name,input.name);
 assert.equal(s.render().busy,false);assert.equal(s.render().error,'');assert.equal(s.changed,1);assert.ok(s.feedback.includes('待确认项目已添加'));
});
test('network retry reuses registration request ID to prevent duplicate items',async()=>{
 const s=setup({failFirst:true});assert.equal(await s.render().act(input),false);assert.equal(s.render().error,'network failed');
 assert.equal(await s.render().act(input),true);assert.equal(s.calls[0].requestId,s.calls[1].requestId);
});
test('request ID generation failure is visible and releases the busy state',async()=>{
 const s=setup({brokenCrypto:true});assert.equal(await s.render().act(input),false);
 assert.equal(s.render().error,'random unavailable');assert.equal(s.render().busy,false);assert.equal(s.calls.length,0);
});

for(const status of [408,500,502,503,504])test(`HTTP ${status} retains the original body after a refresh advances the version`,async()=>{
 const s=setup({failFirst:true,status});assert.equal(await s.render().act(input),false);
 assert.equal(s.render().data.version,1);assert.equal(await s.render().act(input),true);
 assert.deepEqual(s.calls[1],s.calls[0]);assert.equal(s.calls[1].expectedVersion,0);
});
test('a definitive version conflict creates a new request against refreshed data',async()=>{
 const s=setup({failFirst:true,status:409});await s.render().act(input);
 assert.equal(await s.render().act(input),true);assert.notEqual(s.calls[1].requestId,s.calls[0].requestId);assert.equal(s.calls[1].expectedVersion,1);
});
test('changed content does not reuse the request key for a failed operation',async()=>{
 const s=setup({failFirst:true,status:502});await s.render().act(input);
 await s.render().act({...input,name:'更换机油'});assert.notEqual(s.calls[1].requestId,s.calls[0].requestId);
});
test('two clicks before React rerenders issue only one POST',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);const s=setup({gate});const c=s.render();
 const first=c.act(input);assert.equal(await c.act(input),false);assert.equal(s.calls.length,1);
 release();assert.equal(await first,true);assert.equal(s.render().busy,false);
});
