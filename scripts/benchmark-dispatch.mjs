import assert from 'node:assert/strict';
import pg from 'pg';
import {performance} from 'node:perf_hooks';
import {EventEmitter} from 'node:events';
import {withRequestTiming,measureStage,writeTimingHeaders} from '../server/http/requestTiming.mjs';
const observability=process.argv.includes('--observability');
import {filterDispatchTasks,countDispatchTaskStatuses} from '../server/domain/dispatchTaskFilters.mjs';
import {warehouseRequests,matchesPartsStatus,sortWarehouseRequests} from '../shared/warehouseRequests.mjs';
import {sortDispatchTasks} from '../server/domain/dispatchTaskSort.mjs';

const url=process.env.RELEASE_TEST_ADMIN_URL;
if(!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw new Error('An isolated local RELEASE_TEST_ADMIN_URL is required');
process.env.DATABASE_URL=url;
const {listDispatchTasks}=await import('../server/repositories/dispatchRepository.mjs');
const client=new pg.Client({connectionString:url});await client.connect();
const manager={id:'manager',name:'Manager',role:'manager',shopId:'shop',active:true};
const technician={...manager,id:'worker0',role:'technician'};
const warehouse={...manager,id:'warehouse',role:'warehouse'};
const queryCases=[
 [manager,{}],[{...manager,id:'advisor',role:'advisor'},{}],[{...manager,id:'inspector',role:'inspector'},{}],[{...technician,role:'outsourcing'},{personal:'true'}],[manager,{technicianId:'worker0'}],[technician,{personal:'true',stage:'回审&维修中'}],
 [technician,{personal:'true',stage:'返工'}],[manager,{search:'A12'}],
 [manager,{executionMode:'outsourced'}],[manager,{executionMode:'internal',search:'A1',includeCompleted:'true'}],
 [warehouse,{partsStatus:'待备料'}],[manager,{workloadState:'working',technicianId:'worker0'}],
 [manager,{counts:'true',search:'ignored'}]
];
function result(tasks,actor,query) {
 const filtered=filterDispatchTasks(tasks,actor,query);
 if(query.partsStatus) {
  const requests=warehouseRequests(filtered);
  const items=sortWarehouseRequests(requests.filter(task=>matchesPartsStatus(task,query.partsStatus)),query.partsSort);
  return {ids:items.map(task=>[task.orderId,task.partsRequirement?.ownerId]),counts:Object.fromEntries(['待备料','部分备齐','备料完成'].map(status=>[status,requests.filter(task=>matchesPartsStatus(task,status)).length]))};
 }
 const items=sortDispatchTasks(filtered,actor,query);
 return {ids:items.map(task=>task.orderId),counts:countDispatchTaskStatuses(tasks,actor,query)};
}
try {
 await client.query('begin');
 await client.query(`create temporary table work_orders(id text primary key,shop_id text,status text,vehicle_plate text,dispatch_no text,arrival_date text,pending_repairs jsonb default '[]',vehicle_vin text,vehicle_model text,vehicle_mileage text,customer_name text,advisor text,technician text,fault_description text);
 create temporary table dispatch_tasks(order_id text primary key,technician_id text,inspector_id text,stage text,version integer,data jsonb);
 create temporary table dispatch_events(order_id text,action text,detail jsonb);
 create temporary table repair_items(order_id text,client_item_id bigint,name text,status text,start_at text,finish_at text,item_no integer);
 create index on work_orders(shop_id);create index on dispatch_tasks(technician_id);
 create index on dispatch_tasks using gin((data->'technicianIds'));`);
 const reports=[];
 for(const size of (observability?[10000]:[1000,10000,50000])) {
  await client.query('truncate work_orders,dispatch_tasks');
  await client.query(`insert into work_orders(id,shop_id,status,vehicle_plate,dispatch_no,arrival_date)
    select 'order'||n,case when n%19=0 then 'other-shop' else 'shop' end,'维修中','TEST'||n,'A'||n,'2026-11-01' from generate_series(1,$1::integer)n`,[size]);
  await client.query(`insert into dispatch_tasks
    select 'order'||n,'worker'||(n%10),null,'维修中',1,jsonb_build_object(
      'technicianIds',case when n%17=0 then null when n%23=0 then '[]'::jsonb else jsonb_build_array('worker'||(n%10)) end,
      'executionMode',case when n%7=0 then 'outsourced' else 'internal' end,
      'assignedAt','2026-11-01T00:00:00Z','acceptedAt','2026-11-01T00:00:00Z',
      'partsRequirement',jsonb_build_object('mode','list','items',jsonb_build_array(jsonb_build_object('name','配件','quantity',1,'unit','个'))),
      'items',jsonb_build_array(jsonb_build_object('id',1,'name','项目','responsibleId','worker'||(n%10),'status',case when n%5=0 then '待检验' else '维修中' end)))
      from generate_series(1,$1::integer)n`,[size]);
  await client.query('analyze work_orders;analyze dispatch_tasks');
  for(const [actor,query] of queryCases) {
    const old=await listDispatchTasks(actor,client),next=await listDispatchTasks(actor,client,query);
    // Old counts=true deliberately ignores all other filters.
    if(query.counts==='true')assert.deepEqual(next,old);
    else assert.deepEqual(result(next,actor,query),result(old,actor,query));
  }
  if(process.argv.includes('--verify-only')){console.log(JSON.stringify({size,equalityCases:queryCases.length,verified:true}));continue;}
  const measurements={};
  for(const [label,query] of [['unfiltered',{}],['personal',{personal:'true',stage:'回审&维修中'}]]) {
    const actor=label==='personal'?technician:manager;
    const samples={before:[],after:[],observed:[]};const overhead=[];const details={};
    for(let i=0;i<(observability?130:14);i++) {
      for(const variant of (observability?(i%2?['observed','after']:['after','observed']):(i%2?['after','before']:['before','after']))) {
        const optimized=variant!=='before';
        // Paired alternating measurements limit cache and GC ordering bias.
        if(!observability)global.gc?.();let rawRows=0,rawBytes=0;
        const measured={query:async(...args)=>{const response=await client.query(...args);rawRows+=response.rows.length;return response;}};
        const work=async()=>result(await listDispatchTasks(actor,measured,optimized?query:{}),actor,query);
        const start=performance.now();let value,workMs=0;
        if(variant==='observed') {
          const res=new EventEmitter();res.statusCode=200;res.setHeader=()=>{};
          value=await withRequestTiming({method:'GET'},res,'/api/dispatch/tasks',async()=>{const result=await measureStage('db_query',async()=>{const at=performance.now();try{return await work();}finally{workMs=performance.now()-at;}});writeTimingHeaders(res);return result;});res.emit('finish');
        } else value=await work();
        const elapsed=performance.now()-start;
        const key=variant;if(i>9||!observability&&i>1){samples[key].push(elapsed);if(variant==='observed')overhead.push(elapsed-workMs);}
        rawBytes=Buffer.byteLength(JSON.stringify(value));details[key]={candidateRows:rawRows,resultBytes:rawBytes};
      }
    }
    for(const key of (observability?['after','observed']:['before','after'])) {
      const times=samples[key].sort((a,b)=>a-b);
      measurements[`${label}_${key}`]={samples:times.length,p50Ms:times[Math.floor(times.length/2)],p95Ms:times[Math.ceil(times.length*.95)-1],...details[key]};
    }
    if(observability){overhead.sort((a,b)=>a-b);measurements[`${label}_instrumentation`]={p50Ms:overhead[Math.floor(overhead.length/2)],p95Ms:overhead[Math.ceil(overhead.length*.95)-1]};}
  }
  const report={size,equalityCases:queryCases.length,rssBytes:process.memoryUsage().rss,measurements};
  reports.push(report);console.log(JSON.stringify(report));
 }
} finally {await client.query('rollback');await client.end();}
