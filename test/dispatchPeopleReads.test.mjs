import test from 'node:test';
import assert from 'node:assert/strict';
import {createPendingRead} from '../server/domain/pendingRead.mjs';
import {hasRole} from '../shared/roles.mjs';

test('overlapping reads share work by scope; settled success and failure are evicted',async()=>{
  const read=createPendingRead();let calls=0,release;
  const load=()=>{calls++;return new Promise(resolve=>{release=resolve;});};
  const a=read('a',load),b=read('a',load);
  assert.equal(a,b);await Promise.resolve();assert.equal(calls,1);
  assert.equal(await read('b',()=>42),42);release(7);assert.equal(await a,7);
  assert.equal(await read('a',()=>8),8);
  const failure=()=>{throw new Error('offline');};
  const x=read('a',failure),y=read('a',failure);assert.equal(x,y);
  await Promise.all([assert.rejects(x,/offline/),assert.rejects(y,/offline/)]);
  assert.equal(await read('a',()=>9),9);
});

test('GET personnel requests coalesce but a transactional check observes revocation during the read',async()=>{
  process.env.DATABASE_URL='postgres://unused:unused@127.0.0.1/unused';
  process.env.APP_ENV='production';process.env.DINGTALK_APP_KEY='test-only';process.env.DINGTALK_APP_SECRET='test-only';
  const {pool}=await import('../server/database/pool.mjs');
  const {readDispatchPeople,dispatchPeople,localDispatchPeople}=await import('../server/repositories/dispatchRepository.mjs');
  const originalQuery=pool.query,originalFetch=globalThis.fetch;
  const worker={id:'worker',name:'维修工',role:'technician',roles:['technician'],active:true,shop_id:'s',dingtalk_user_id:'ding'};
  let sql=0,roleCalls=0,release,started;
  const waiting=new Promise(resolve=>{started=resolve;});
  pool.query=async(_sql,[shopId])=>{sql++;return {rows:[{...worker,shop_id:shopId}]};};
  globalThis.fetch=async url=>{
    const pathname=new URL(url).pathname;
    if(pathname.endsWith('/gettoken'))return {ok:true,json:async()=>({access_token:'test-token',expires_in:7200})};
    let result;
    if(pathname.endsWith('/role/list')){
      roleCalls++;
      if(roleCalls===1){started();await new Promise(resolve=>{release=resolve;});result={list:[{roles:[{id:1,name:'维修工'}]}]};}
      else result={list:[]}; // Membership was revoked while the GET was in flight.
    }else {assert.ok(pathname.endsWith('/role/simplelist'));result={list:[{userid:'ding'}]};}
    return {ok:true,json:async()=>({errcode:0,result})};
  };
  try {
    const a=readDispatchPeople({shopId:'s'}),b=readDispatchPeople({shopId:'s'});
    assert.equal(a,b);await waiting;assert.equal(sql,1);
    const fresh=await dispatchPeople({shopId:'s'},{query:pool.query});
    assert.equal(hasRole(fresh[0],'technician'),false);assert.equal(roleCalls,2);
    release();assert.equal(hasRole((await a)[0],'technician'),true);
    const next=await readDispatchPeople({shopId:'s'});
    assert.equal(hasRole(next[0],'technician'),false);assert.equal(roleCalls,3);
    await Promise.all([readDispatchPeople({shopId:'s'}),readDispatchPeople({shopId:'other'})]);
    assert.equal(roleCalls,5,'different shops do not share personnel');
    const before=roleCalls;await localDispatchPeople({shopId:'s'});assert.equal(roleCalls,before,'role-specific notification sync needs no technician lookup');
  }finally{release?.();pool.query=originalQuery;globalThis.fetch=originalFetch;await pool.end();}
});
