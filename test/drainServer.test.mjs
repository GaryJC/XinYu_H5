import test from 'node:test';
import assert from 'node:assert/strict';
import {drainServer} from '../server/http/drainServer.mjs';
test('shutdown stops every worker before HTTP drain and keeps pools until both finish',async()=>{
 const events=[];let releaseWorker,releaseHttp;
 const worker=new Promise(resolve=>releaseWorker=resolve);
 const draining=drainServer({close:done=>{events.push('http');releaseHttp=done;},closeIdleConnections:()=>events.push('idle')},[()=>{events.push('stop-a');return worker;},()=>events.push('stop-b')],[()=>events.push('pool')]);
 assert.deepEqual(events,['stop-a','stop-b','http','idle']);releaseHttp();await Promise.resolve();assert.ok(!events.includes('pool'));releaseWorker();await draining;assert.equal(events.at(-1),'pool');
});
test('a failed drain does not close pools underneath other live requests',async()=>{
 let ended=false;
 await assert.rejects(()=>drainServer({close:done=>done(new Error('drain failed')),closeIdleConnections(){}},[],[()=>ended=true]),/drain failed/);assert.equal(ended,false);
});
