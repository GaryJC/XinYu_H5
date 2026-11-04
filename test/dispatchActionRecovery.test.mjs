import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {hasAnyRole,hasRole} from '../shared/roles.mjs';

function setup({status,failRequestId=false}={}) {
 const compiled=ts.transpileModule(readFileSync(new URL('../client/src/features/dispatch/useDispatchController.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const slots=[],exports={},calls=[],committed=new Set();let cursor=0,ids=0,version=1;
 const react={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
  useRef(initial){const i=cursor++;return slots[i]??={current:initial};},useCallback:fn=>fn,useEffect(){}
 };
 const api={
  detail:async id=>({task:{orderId:id,version}}),people:async()=>({technicians:[],inspectors:[],contractors:[]}),summaries:async()=>[],
  action:async(id,body)=>{
   calls.push(body);
   // A gateway can lose the response after the transaction committed.
   if(status!==409&&!committed.has(body.requestId)){committed.add(body.requestId);version++;}
   if(calls.length===1&&status){if(status===409)version++;throw Object.assign(new Error('request failed'),{status});}
  }
 };
 vm.runInNewContext(compiled,{exports,Error,URL,URLSearchParams,location:{href:'http://localhost/',search:''},history:{replaceState(){}},require(id){
  if(id==='react')return react;
  if(id==='antd')return {Grid:{useBreakpoint:()=>({md:true})}};
  if(id.endsWith('usePagedList'))return {usePagedList:()=>({items:[],loading:false,error:'',refresh:async()=>{}})};
  if(id.endsWith('useActionFeedback'))return {useActionFeedback:()=>({success(){},error(){},warning(){}})};
  if(id.endsWith('roles.mjs'))return {hasAnyRole,hasRole};
  if(id.endsWith('requestId'))return {createRequestId(){ids++;if(failRequestId&&ids===1)throw new Error('random unavailable');return `dispatch-retry-${ids}`;}};
  if(id.endsWith('dispatchApi'))return {dispatchApi:api};
  throw new Error(id);
 }});
 return {calls,committed,render(){cursor=0;return exports.useDispatchController({id:'manager',role:'manager',shopId:'shop',active:true},'派工台','order');}};
}

for(const status of [408,500,502,503,504])test(`dispatch HTTP ${status} retries the committed operation with its original version and request ID`,async()=>{
 const s=setup({status});await s.render().refreshDetail();
 assert.equal(await s.render().act({action:'remind'}),false);
 assert.equal(s.render().detail.task.version,2);
 assert.equal(await s.render().act({action:'remind'}),true);
 assert.deepEqual(s.calls[1],s.calls[0]);assert.equal(s.committed.size,1);
});

test('dispatch version conflict discards the rejected body and uses refreshed data',async()=>{
 const s=setup({status:409});await s.render().refreshDetail();
 await s.render().act({action:'remind'});await s.render().act({action:'remind'});
 assert.notEqual(s.calls[0].requestId,s.calls[1].requestId);assert.equal(s.calls[1].expectedVersion,2);
});

test('request ID failure reports the error and unlocks dispatch controls for retry',async()=>{
 const s=setup({failRequestId:true});await s.render().refreshDetail();
 assert.equal(await s.render().act({action:'remind'}),false);
 assert.equal(s.render().busy,false);assert.equal(s.render().error,'random unavailable');assert.equal(s.calls.length,0);
 assert.equal(await s.render().act({action:'remind'}),true);assert.equal(s.calls.length,1);
});
