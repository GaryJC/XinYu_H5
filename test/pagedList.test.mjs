import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.transpileModule(fs.readFileSync('client/src/shared/hooks/usePagedList.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(load,mobile=false) {
  const slots=[],effects=[],timers=new Map();let cursor=0,nextTimer=0,key='initial',enabled=true;
  const exports={};
  const react={
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},
    useRef(initial){const i=cursor++;return slots[i]??={current:initial};},
    useCallback(fn){return fn;},
    useEffect(fn,deps){const i=cursor++;const previous=slots[i];if(!previous||deps.some((v,n)=>v!==previous.deps[n])){previous?.cleanup?.();slots[i]={deps};effects.push(()=>{slots[i].cleanup=fn();});}}
  };
  vm.runInNewContext(source,{exports,Error,Map,window:{setTimeout:fn=>{const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)},require:id=>{assert.equal(id,'react');return react;}});
  return {render(){cursor=0;const state=exports.usePagedList(key,page=>load(page,key),mobile,enabled,item=>item.id);for(const effect of effects.splice(0))effect();return state;},
    async request(){for(const [id,fn] of [...timers]){timers.delete(id);fn();}await flush();},
    key(value){key=value;},mobile(value){mobile=value;},enabled(value){enabled=value;}};
}
const result=(page,ids,total=45)=>({page,pageSize:20,total,items:ids.map(id=>({id}))});
const ids=page=>Array.from({length:page===3?5:20},(_,i)=>String((page-1)*20+i));

test('desktop requests the next page only on navigation; renders only that page',async()=>{
  const calls=[],h=harness(async page=>{calls.push(page);return result(page,ids(page));});
  h.render();await h.request();assert.deepEqual(calls,[1]);assert.equal(h.render().items.length,20);
  h.render().setPage(2);h.render();await h.request();assert.deepEqual(calls,[1,2]);assert.equal(h.render().items[0].id,'20');assert.equal(h.render().items.length,20);
});
test('mobile appends requested pages, deduplicates changed offsets and resets on filtering',async()=>{
  const calls=[],h=harness(async(page,key)=>{calls.push([page,key]);return result(page,page===2?['19',...ids(2)]:ids(page));},true);
  h.render();await h.request();h.render().loadMore();h.render();await h.request();assert.equal(h.render().items.length,40);
  h.key('search');assert.equal(h.render().items.length,0);await h.request();assert.equal(h.render().items.length,20);assert.equal(calls.at(-1)[0],1);
});
test('old filter response cannot overwrite the new filter or its count',async()=>{
  let release;const old=new Promise(resolve=>{release=resolve;});
  const h=harness((page,key)=>key==='initial'?old:Promise.resolve(result(1,['new'],1)));
  h.render();await h.request();h.key('new');h.render();await h.request();
  release(result(1,['old'],99));await flush();assert.equal(h.render().items[0].id,'new');assert.equal(h.render().total,1);
});
test('failed mobile next page retains existing rows and retries the same page',async()=>{
  const calls=[];let fail=true;const h=harness(async page=>{calls.push(page);if(page===2&&fail)throw new Error('offline');return result(page,ids(page));},true);
  h.render();await h.request();h.render().loadMore();h.render();await h.request();assert.equal(h.render().items.length,20);assert.equal(h.render().loading,false);
  fail=false;h.render().loadMore();h.render();await h.request();assert.deepEqual(calls,[1,2,2]);assert.equal(h.render().items.length,40);
});
test('failed desktop page can be selected again to retry',async()=>{
  let fail=true;const h=harness(async page=>{if(page===2&&fail)throw new Error('offline');return result(page,ids(page));});
  h.render();await h.request();h.render().setPage(2);h.render();await h.request();fail=false;
  h.render().setPage(2);h.render();await h.request();assert.equal(h.render().page,2);assert.equal(h.render().items.length,20);
});
test('refresh revalidates all loaded mobile pages and keeps accumulated records',async()=>{
  const calls=[],h=harness(async page=>{calls.push(page);return result(page,ids(page));},true);
  h.render();await h.request();h.render().loadMore();h.render();await h.request();await h.render().refresh();
  assert.deepEqual(calls,[1,2,1,2]);assert.equal(h.render().items.length,40);
});
test('layout and user changes invalidate requests; hidden lists make no requests',async()=>{
  const calls=[],h=harness(async page=>{calls.push(page);return result(page,ids(page));});
  h.render();await h.request();h.render().setPage(2);h.render();await h.request();h.mobile(true);h.render();await h.request();assert.equal(h.render().page,1);
  h.enabled(false);h.key('another-user');h.render();await h.request();assert.deepEqual(calls,[1,2,1]);assert.equal(h.render().items.length,0);
});
test('returning to an earlier filter starts on page one, not its stale previous page',async()=>{
  const calls=[],h=harness(async(page,key)=>{calls.push([page,key]);return result(page,ids(page));});
  h.render();await h.request();h.render().setPage(3);h.render();await h.request();
  h.key('search');h.render();h.render();await h.request();
  h.key('initial');h.render();h.render();await h.request();
  assert.equal(h.render().page,1);assert.deepEqual(calls.at(-1),[1,'initial']);
});
test('shrinking the last mobile page removes stale pages beyond the new total',async()=>{
  let shrink=false;const h=harness(async page=>shrink?result(2,['last'],21):result(page,ids(page)),true);
  h.render();await h.request();h.render().loadMore();h.render();await h.request();h.render().loadMore();h.render();await h.request();
  shrink=true;h.render().loadMore();h.render();await h.request();assert.equal(h.render().page,2);assert.equal(h.render().items.length,21);
});
