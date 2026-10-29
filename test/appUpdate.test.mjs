import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import {readAppVersion} from '../server/services/appVersionService.mjs';
import {handleAppVersion} from '../server/routes/appVersionRouter.mjs';
import {serveStatic} from '../server/http/staticFiles.mjs';
const source=await readFile(new URL('../client/src/shared/app-update/versionMonitor.ts',import.meta.url),'utf8');
const {startVersionMonitor}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText).toString('base64'));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(t){
 let now=0,body={version:'old'},status=200,calls=0;
 t.mock.method(Date,'now',()=>now);
 const doc=Object.assign(new EventTarget(),{visibilityState:'visible'}),win=new EventTarget(),storage=new Map(),timers=new Map();let id=0;
 Object.assign(win,{sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:n=>timers.delete(n),setInterval:fn=>{win.poll=fn;return ++id;},clearInterval:()=>{win.poll=undefined;}});
 const updates=[];
 const fetchVersion=async(url,options)=>{calls++;assert.equal(url,'/api/app-version');assert.equal(options.cache,'no-store');return {ok:status===200,json:async()=>body};};
 const start=()=>startVersionMonitor({version:'old',doc,win,fetchVersion,onUpdate:v=>updates.push(v)});
 return {doc,win,updates,start,timers,get calls(){return calls;},setBody:v=>body=v,setStatus:v=>status=v,advance:()=>now+=180_000};
}
test('same build stays quiet; new builds notify once across polls and remounts',async t=>{
 const h=harness(t);let stop=h.start();await flush();assert.deepEqual(h.updates,[]);
 h.setBody({version:'new'});h.advance();h.win.poll();await flush();assert.deepEqual(h.updates,['new']);
 h.advance();h.win.poll();await flush();assert.deepEqual(h.updates,['new']);stop();
 stop=h.start();await flush();assert.deepEqual(h.updates,['new']);
 h.setBody({version:'newer'});h.advance();h.win.dispatchEvent(new Event('focus'));await flush();assert.deepEqual(h.updates,['new','newer']);stop();
});
test('hidden pages skip checks; foreground checks are throttled and cleanup removes listeners',async t=>{
 const h=harness(t);h.doc.visibilityState='hidden';const stop=h.start();await flush();assert.equal(h.calls,0);
 h.doc.visibilityState='visible';h.doc.dispatchEvent(new Event('visibilitychange'));await flush();assert.equal(h.calls,1);
 h.win.dispatchEvent(new Event('focus'));await flush();assert.equal(h.calls,1);
 h.advance();h.win.dispatchEvent(new Event('pageshow'));await flush();assert.equal(h.calls,2);
 stop();h.advance();h.win.dispatchEvent(new Event('focus'));await flush();assert.equal(h.calls,2);assert.equal(h.win.poll,undefined);
});
test('invalid and failed responses remain silent and later recover',async t=>{
 const h=harness(t);h.setStatus(503);const stop=h.start();await flush();
 h.setStatus(200);for(const value of [null,{}, {version:''},{version:7}]){h.setBody(value);h.advance();h.win.poll();await flush();}
 assert.deepEqual(h.updates,[]);h.setBody({version:'good'});h.advance();h.win.poll();await flush();assert.deepEqual(h.updates,['good']);stop();
});
test('pending checks are aborted on unmount and cannot notify afterward',async t=>{
 const h=harness(t);let resolve,signal;
 const stop=startVersionMonitor({version:'old',doc:h.doc,win:h.win,onUpdate:v=>h.updates.push(v),fetchVersion:(_,o)=>{signal=o.signal;return new Promise(r=>resolve=r);}});
 stop();assert.ok(signal.aborted);resolve({ok:true,json:async()=>({version:'new'})});await flush();assert.deepEqual(h.updates,[]);
});
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=body;}};}
test('version endpoint reads deployed manifest, bypasses caching, and missing manifests fail closed',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'app-version-'));
 try{
  await assert.rejects(()=>readAppVersion(dir),e=>e.status===503);
  await writeFile(path.join(dir,'app-version.json'),JSON.stringify({version:'release-a',secret:'not-exposed'}));
  const res=response();assert.equal(await handleAppVersion({method:'GET'},res,new URL('http://localhost/api/app-version'),()=>readAppVersion(dir)),true);
  assert.deepEqual(JSON.parse(res.body),{version:'release-a'});assert.match(res.headers['Cache-Control'],/no-store/);
  await writeFile(path.join(dir,'app-version.json'),JSON.stringify({version:'release-b'}));assert.deepEqual(await readAppVersion(dir),{version:'release-b'});
  await writeFile(path.join(dir,'index.html'),'<html>new build</html>');const html=response();await serveStatic(html,'/',dir);assert.equal(html.headers['Cache-Control'],'no-store');
 }finally{await rm(dir,{recursive:true,force:true});}
});
