import test from 'node:test';import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:1/unused';
const {warehouseVehiclePartsHistory,warehouseHistoricalPartStock}=await import('../server/services/warehouseStockService.mjs');
import{findVehiclePartsHistory,VEHICLE_PARTS_ORDERS_QUERY}from'../server/repositories/runfengVehiclePartsRepository.mjs';
import{buildRunfengPartsQuery}from'../server/repositories/runfengStockRepository.mjs';
const actor={id:'w',role:'warehouse',active:true,shopId:'s'};
const deps={configured:()=>true,getTask:async()=>({plate:' 鲁-B12345 ',dispatchNo:'A123',orderStatus:'待派工',partsRequirement:{mode:'list'}})};
function configure(callback){const params={};callback({input:(key,_type,value)=>{params[key]=value;}},{NVarChar:n=>n,Int:'int'});return params;}
test('new vehicles stop after checking repair history and never trigger catalog or inventory lookup',async()=>{
 let calls=0;
 const history=await findVehiclePartsHistory({plate:'鲁B12345',excludeDispatch:'A123'},async(query,callback)=>{calls++;const p=configure(callback);assert.equal(p.plate,'鲁B12345');assert.equal(p.exclude_dispatch,'A123');return {recordset:[]};});
 assert.equal(calls,1);assert.equal(history.status,'no_history');assert.deepEqual(history.items,[]);
 let stock=0;const d={...deps,findHistory:async input=>{assert.equal(input.plate,'鲁B12345');assert.equal(input.excludeDispatch,'A123');return history;},findParts:async()=>{stock++;}};
 assert.equal((await warehouseVehiclePartsHistory(actor,'o',d)).status,'no_history');
 await assert.rejects(()=>warehouseHistoricalPartStock(actor,'o',{code:'GLOBAL'},d),e=>e.status===409);assert.equal(stock,0);
});
test('history uses the canonical repair ledger, same plate, material snapshots and excludes current repair',()=>{
 assert.match(VEHICLE_PARTS_ORDERS_QUERY,/w\.wd=''/);assert.match(VEHICLE_PARTS_ORDERS_QUERY,/=@plate/);assert.match(VEHICLE_PARTS_ORDERS_QUERY,/pgd\)<>@exclude_dispatch/);assert.match(VEHICLE_PARTS_ORDERS_QUERY,/isnull\(w.del,''\)<>'1'/);assert.doesNotMatch(VEHICLE_PARTS_ORDERS_QUERY,/like|\b(insert|update|delete)\b/i);
 const exact=buildRunfengPartsQuery(1,true);assert.match(exact,/and h.hh=@exact/);assert.doesNotMatch(exact,/h\.pm like/);
});
test('latest historical models preserve unit and specification, summing only lines in the same repair',async()=>{
 let calls=0;
 const result=await findVehiclePartsHistory({plate:'鲁B12345'},async(query,callback)=>{
  configure(callback);calls++;
  if(calls===1)return{recordset:[{id:20,order_no:200,dispatch_no:'A200',repaired_at:'2026.10.01',vehicle_model:'车型'},{id:10,order_no:100,dispatch_no:'A100',repaired_at:'2025.10.01'}]};
  assert.match(query,/m\.lb='材料'/);assert.match(query,/m\.hh0\) as code/);assert.match(query,/m\.hh\) as name/);assert.match(query,/m\.sl>0/);
  return{recordset:[{order_no:200,code:'OIL',name:'上次使用机油',specification:'SN5W30',unit:'升',quantity:3},{order_no:200,code:'oil',name:'同号追加',specification:'SN5W30',unit:'升',quantity:1},{order_no:100,code:'OIL',name:'更早机油',specification:'SN5W30',unit:'升',quantity:9},{order_no:100,code:'OIL',name:'桶装机油',specification:'SN5W30',unit:'桶',quantity:1},{order_no:100,code:'OLD',name:'旧型号',specification:'5W40',unit:'桶',quantity:1}]};
 });
 assert.equal(result.status,'found');assert.equal(result.items.length,3);assert.equal(result.items[0].quantity,4);assert.equal(result.items[0].dispatchNo,'A200');assert.equal(result.items[0].name,'上次使用机油');assert.equal(result.items[1].unit,'桶');assert.equal(result.items[1].quantity,1);
});
test('existing repair without material lines is distinct from a new vehicle; limits are explicit',async()=>{
 let calls=0;const noParts=await findVehiclePartsHistory({plate:'P'},async()=>({recordset:++calls===1?[{id:1,order_no:1}]:[]}));assert.equal(noParts.status,'no_parts');assert.equal(calls,2);
 let n=0;const capped=await findVehiclePartsHistory({plate:'P'},async(q,callback)=>{const p=configure(callback);if(++n===1)return{recordset:Array.from({length:51},(_,i)=>({id:i,order_no:i}))};assert.equal(Object.keys(p).length,50);return{recordset:Array.from({length:501},(_,i)=>({order_no:0,code:`C${i}`,quantity:1}))};});assert.equal(capped.items.length,60);assert.equal(capped.hasMore,true);
});
test('only a selected historical code can query exact inventory; errors never masquerade as a new vehicle',async()=>{
 const d={...deps,findHistory:async()=>({status:'found',items:[{code:'OLD'}],hasMore:false}),findParts:async filter=>{assert.equal(filter.query,'old');assert.equal(filter.exactCodeOnly,true);assert.equal(filter.inStockOnly,false);return{items:[],hasMore:false};}};
 assert.equal((await warehouseHistoricalPartStock(actor,'o',{code:'old'},d)).query,'old');
 await assert.rejects(()=>warehouseHistoricalPartStock(actor,'o',{code:'other'},d),e=>e.status===409);
 await assert.rejects(()=>warehouseVehiclePartsHistory({...actor,role:'technician'},'o',d),e=>e.status===403);
 await assert.rejects(()=>warehouseVehiclePartsHistory(actor,'o',{...d,getTask:async()=>({orderStatus:'待派工',partsRequirement:{},plate:''})}),e=>e.status===409);
 await assert.rejects(()=>warehouseVehiclePartsHistory(actor,'o',{...d,findHistory:async()=>{throw Error('private connection details');}}),e=>e.status===502&&!e.message.includes('details'));
});
