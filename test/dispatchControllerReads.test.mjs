import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {hasAnyRole,hasRole} from '../shared/roles.mjs';
const source=ts.transpileModule(fs.readFileSync('client/src/features/dispatch/useDispatchController.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const personnel={technicians:[{id:'worker'}],inspectors:[],contractors:[]};
function harness({mode='list',initialId,loadPeople=async()=>personnel}={}){
 const slots=[],effects=[],events=new Map(),timers=new Set(),calls={people:0,summaries:0,detail:0,list:0};let cursor=0;
 const user={id:'advisor',role:'advisor',roles:['advisor']};
 const list={items:[],loading:false,error:'',refresh:async()=>{calls.list++;}};
 const exports={};
 const react={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},
  useRef(initial){const i=cursor++;return slots[i]??={current:initial};},
  useCallback(fn,deps){const i=cursor++;if(!slots[i]||deps.some((v,n)=>v!==slots[i].deps[n]))slots[i]={fn,deps};return slots[i].fn;},
  useEffect(fn,deps){const i=cursor++,prev=slots[i];if(!prev||deps.some((v,n)=>v!==prev.deps[n])){prev?.cleanup?.();slots[i]={deps,effect:fn};effects.push(()=>{slots[i].cleanup=fn();});}}
 };
 const eventTarget={addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:(name,fn)=>{if(events.get(name)===fn)events.delete(name);}};
 const api={people:async()=>{calls.people++;return loadPeople();},summaries:async()=>{calls.summaries++;return [];},detail:async id=>{calls.detail++;return {task:{orderId:id,version:1}};},action:async()=>{}};
 vm.runInNewContext(source,{exports,Map,Promise,Error,URL,URLSearchParams,clearInterval:fn=>timers.delete(fn),location:{href:'http://local/',search:''},history:{replaceState(){}},document:{visibilityState:'visible',...eventTarget},
  window:{...eventTarget,setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn)},require:id=>{
   if(id==='react')return react;
   if(id==='antd')return {Grid:{useBreakpoint:()=>({md:true})}};
   if(id.endsWith('/usePagedList'))return {usePagedList:()=>list};
   if(id.endsWith('/useActionFeedback'))return {useActionFeedback:()=>({success(){},error(){},warning(){}})};
   if(id.endsWith('/roles.mjs'))return {hasAnyRole,hasRole};
   if(id.endsWith('/requestId'))return {createRequestId:()=> 'request-test'};
   if(id==='./dispatchApi')return {dispatchApi:api};
   throw Error(`Unexpected import: ${id}`);
  }});
 return {calls,render(){cursor=0;const value=exports.useDispatchController(user,'派工台',initialId,undefined,mode);for(const fn of effects.splice(0))fn();return value;},replayEffects(){for(const slot of slots)slot?.cleanup?.();for(const slot of slots)if(slot?.effect)slot.cleanup=slot.effect();},poll(){for(const fn of timers)fn();},focus(){events.get('focus')?.();}};
}
test('list and unrelated filter changes do not load personnel or repeat summaries',async()=>{
 const h=harness();h.render();await flush();let c=h.render();
 assert.equal(h.calls.people,0);assert.equal(h.calls.summaries,1);
 c.setFilters({stage:'维修中',search:'车牌',sort:'newest'});h.render();await flush();
 assert.equal(h.calls.summaries,1);assert.equal(h.calls.people,0);
 h.render().setFilters({from:'2026-11-01'});h.render();await flush();assert.equal(h.calls.summaries,2);
 h.poll();h.focus();await flush();assert.equal(h.calls.summaries,3,'overlapping refresh has one summary request');assert.equal(h.calls.people,0);
});
test('detail opens personnel once, polling preserves them, manual refresh and reopening reload',async()=>{
 const h=harness();h.render();await flush();h.render().select('one');h.render();await flush();let c=h.render();
 assert.equal(h.calls.people,1);assert.equal(c.people.technicians[0].id,'worker');assert.equal(c.detail.task.orderId,'one');
 h.poll();h.focus();await flush();assert.equal(h.calls.people,1);
 await h.render().refresh();assert.equal(h.calls.people,2);
 h.render().select();h.render();await flush();assert.equal(h.render().people.technicians.length,0);
 h.render().select('one');h.render();await flush();assert.equal(h.calls.people,3);
});
test('detail-only mode waits for personnel before initializing editors and can retry failure',async()=>{
 let release,fail=true;
 const h=harness({mode:'detail',initialId:'one',loadPeople:()=>new Promise((resolve,reject)=>{release=()=>fail?reject(Error('offline')):resolve(personnel);})});
 h.render();await flush();assert.equal(h.render().detail,undefined);assert.equal(h.calls.summaries,0);assert.equal(h.calls.list,0);
 release();await flush();assert.match(h.render().error,/offline/);
 fail=false;const retry=h.render().refresh();release();await retry;await flush();assert.equal(h.render().error,'');assert.equal(h.render().people.technicians.length,1);
});
test('a closed selection ignores late personnel and detail responses',async()=>{
 let release;const h=harness({loadPeople:()=>new Promise(resolve=>{release=resolve;})});
 h.render();await flush();h.render().select('one');h.render();await flush();
 h.render().select();h.render();release(personnel);await flush();
 assert.equal(h.render().people.technicians.length,0);assert.equal(h.render().detail,undefined);assert.equal(h.render().loading,false);
});
test('StrictMode effect replay does not strand detail or summary loading',async()=>{
 const h=harness({initialId:'one'});h.render();h.replayEffects();await flush();
 const c=h.render();assert.equal(c.loading,false);assert.equal(c.detailLoading,false);assert.equal(c.detail.task.orderId,'one');assert.equal(c.people.technicians.length,1);
});

test('browser personnel reads coalesce by user and recover after failure without caching results',async()=>{
 const source=ts.transpileModule(fs.readFileSync('client/src/features/dispatch/dispatchApi.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const pending=[];let calls=0,token='session-one';const exports={};
 vm.runInNewContext(source,{exports,Map,URLSearchParams,require:id=>{assert.ok(id.endsWith('/httpClient'));return {getAuthToken:()=>token,request:()=>{calls++;return new Promise((resolve,reject)=>pending.push({resolve,reject}));}};}});
 const api=exports.dispatchApi,a=api.people('a'),b=api.people('a'),other=api.people('b');
 assert.equal(a,b);assert.equal(calls,2);pending[0].reject(Error('offline'));pending[1].resolve(personnel);
 await Promise.all([assert.rejects(a,/offline/),assert.rejects(b,/offline/),other]);
 const retry=api.people('a');assert.equal(calls,3);pending[2].resolve(personnel);await retry;
 const next=api.people('a');assert.equal(calls,4);pending[3].resolve(personnel);await next;
 const oldSession=api.people('a');token='session-two';const newSession=api.people('a');assert.notEqual(oldSession,newSession);assert.equal(calls,6);
 pending[4].reject(Error('session changed'));pending[5].resolve(personnel);await Promise.all([assert.rejects(oldSession,/session changed/),newSession]);
});
