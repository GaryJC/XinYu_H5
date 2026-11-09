import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL||='postgresql://unused/unused';
const {startRuntimeMetrics}=await import('../server/workers/runtimeMetrics.mjs');
test('metrics stop prevents further queue reads and drains the active query',async()=>{
 let release,started;const ready=new Promise(resolve=>{started=resolve;});let reads=0,logs=0;
 const stop=startRuntimeMetrics({intervalMs:5,database:{query:async()=>{reads++;started();await new Promise(resolve=>{release=resolve;});return {rows:[]};}},log:()=>logs++});
 // Keep the test process alive while the unref'ed production timer starts.
 const keepAlive=setTimeout(()=>{},1000);
 try {await ready;const draining=stop();release();await draining;assert.equal(reads,1);assert.equal(logs,0);}finally{clearTimeout(keepAlive);await stop();}
});
test('a metrics database error is redacted and the following tick recovers',async()=>{
 let reads=0,resolve;const ready=new Promise(done=>resolve=done),errors=[],original=console.error;
 console.error=(...args)=>errors.push(args);const keep=setTimeout(()=>resolve(),1000);
 let completed=false;
 const stop=startRuntimeMetrics({intervalMs:2,database:{query:async()=>{if(++reads===1)throw Object.assign(new Error('secret customer body'),{code:'08006'});return {rows:[]};}},log:()=>{completed=true;resolve();}});
 try {await ready;await stop();assert.equal(completed,true);assert.equal(errors[0][1].code,'08006');assert.doesNotMatch(JSON.stringify(errors),/secret|customer/);}finally{await stop();clearTimeout(keep);console.error=original;}
});
