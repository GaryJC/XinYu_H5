import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:1/unused';
const {getDispatchTask}=await import('../server/repositories/dispatchRepository.mjs');
const warehouse={id:'w',role:'warehouse',shopId:'s',active:true};
const row={order_id:'order',shop_id:'s',order_status:'维修中',vehicle_plate:'鲁B12345',vehicle_vin:'VIN123',vehicle_model:'车型',vehicle_mileage:'12345',repair_items:[{id:1,name:'更换机油'}],data:{partsRequirement:{mode:'list',items:[]}}};
const database=value=>({query:async()=>({rows:value?[value]:[]})});
test('warehouse task includes canonical vehicle and repair information',async()=>{
 const task=await getDispatchTask(database(row),'order',warehouse);
 assert.equal(task.vehicleVin,'VIN123');assert.equal(task.vehicleModel,'车型');assert.equal(task.vehicleMileage,'12345');assert.equal(task.items[0].name,'更换机油');
});
test('warehouse read authorization rejects other shops, inactive users, drafts and orders without parts',async()=>{
 for(const [record,user] of [
  [row,{...warehouse,shopId:'other'}], [row,{...warehouse,active:false}],
  [{...row,order_status:'草稿'},warehouse], [{...row,order_status:'待客户签字'},warehouse],
  [{...row,data:{}},warehouse]
 ])await assert.rejects(()=>getDispatchTask(database(record),'order',user),e=>e.status===403);
 await assert.rejects(()=>getDispatchTask(database(null),'missing',warehouse),e=>e.status===404);
 const task=await getDispatchTask(database({...row,data:{},has_parts_history:true}),'order',warehouse);
 assert.equal(task.hasPartsHistory,true);
});
