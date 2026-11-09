import pg from 'pg';
import {performance} from 'node:perf_hooks';
const url=process.env.RELEASE_TEST_ADMIN_URL;
if(!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw Error('An isolated local database is required');
process.env.DATABASE_URL=url;
const {startRuntimeMetrics}=await import('../server/workers/runtimeMetrics.mjs');
const queries=[];let done;const ready=new Promise(resolve=>done=resolve);
const keep=setTimeout(()=>{},1000);
const stop=startRuntimeMetrics({intervalMs:1,database:{query:async sql=>{queries.push(sql);return {rows:[]};}},log:()=>done()});
await ready;await stop();clearTimeout(keep);
const db=new pg.Client({connectionString:url});await db.connect();
try {
 await db.query('begin');
 for(const table of ['legacy_sync_outbox','repair_writebacks','dispatch_notifications','procurement_notifications']) {
  await db.query(`create temporary table ${table}(status text,created_at timestamptz);insert into ${table} select 'pending',now()-n*interval '1 second' from generate_series(1,50000)n;analyze ${table}`);
 }
 const times=[];for(let i=0;i<25;i++){const start=performance.now();for(const query of queries)await db.query(query);if(i>=5)times.push(performance.now()-start);}
 times.sort((a,b)=>a-b);console.log(JSON.stringify({queues:queries.length,rowsPerQueue:50000,allPending:true,samples:times.length,p50Ms:times[10],p95Ms:times[18],periodMs:60000,p95WallTimeShare:times[18]/60000}));
} finally {await db.query('rollback');await db.end();}
