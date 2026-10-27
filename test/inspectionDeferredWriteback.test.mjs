import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:1/unused';
const {processInspectionDeferred}=await import('../server/services/inspectionDeferredService.mjs');
const inspector={id:'i',name:'检验员',role:'inspector',active:true,shopId:'s'};
const technician={id:'t',name:'维修工',role:'technician',active:true,shopId:'s'};
function fixture({remainingStatus='已完工',bound=true,stage='维修中'}={}) {
 const task={orderId:'o',plate:'沪ATEST',shopId:'s',stage,version:1,technicianId:'t',technicianIds:['t'],items:[{id:1,name:'本轮通过项目',status:remainingStatus,responsibleId:'t'},{id:2,name:'取消项目',status:'维修中',responsibleId:'t'}]};
 let pending=[{id:'p',itemId:2,source:'inspection',sourceInspectorId:'i',name:'取消项目',inspectionState:'scheduled',history:[]}];
 const jobs=[];let saved;
 const client={query:async(sql,args)=>{
  if(sql.includes('from work_orders wo left join'))return {rows:[{order_id:'o',shop_id:'s',vehicle_plate:task.plate,order_status:'维修中',stage:task.stage,technician_id:'t',version:1,data:task,repair_items:[]}]};
  if(sql.startsWith('select id,name,role'))return {rows:[inspector,technician].map(p=>({...p,shop_id:'s'}))};
  if(sql.startsWith('select id,legacy_employee_code'))return {rows:[{id:'t',legacy_employee_code:bound?'001':null,legacy_employee_name:bound?'维修工':null}]};
  if(sql.startsWith('select pending_repairs'))return {rows:[{items:pending}]};
  if(sql.startsWith('update work_orders set pending_repairs='))pending=JSON.parse(args[1]);
  if(sql.startsWith('select snapshot'))return {rows:[{snapshot:{items:[{id:2,name:'【待定】取消项目'}]}}]};
  if(sql.startsWith('insert into dispatch_tasks'))saved={stage:args[4],...JSON.parse(args[6])};
  if(sql.startsWith('insert into dispatch_events'))return {rows:[{id:100}]};
  if(sql.startsWith('insert into repair_writebacks'))jobs.push({snapshot:JSON.parse(args[2]),status:args[3],error:args[4]});
  return {rows:[],rowCount:1};
 }};
 return {jobs,get saved(){return saved;},cancel:()=>processInspectionDeferred(client,inspector,'o',{action:'cancel',id:'p',note:'不再维修',requestId:'cancel-request'},{items:pending,version:1})};
}
test('cancelling last unfinished item publishes passed work and excludes the cancelled item',async()=>{
 const f=fixture();await f.cancel();
 assert.equal(f.saved.stage,'维修完成');assert.equal(f.jobs.length,1);
 assert.equal(f.jobs[0].snapshot.operation,'replace');assert.equal(f.jobs[0].status,'pending');
 assert.deepEqual(f.jobs[0].snapshot.items.map(i=>i.id),[1]);
});
test('cancelling while another project is active still queues removal only',async()=>{
 const f=fixture({remainingStatus:'维修中'});await f.cancel();
 assert.equal(f.saved.stage,'维修中');assert.equal(f.jobs[0].snapshot.operation,'remove');
 assert.ok(!f.jobs[0].snapshot.items.some(i=>i.id===1));
});
test('missing bindings do not undo cancellation and are exposed as a recoverable failed full snapshot',async()=>{
 const f=fixture({bound:false});await f.cancel();
 assert.equal(f.saved.stage,'维修完成');assert.equal(f.jobs[0].status,'failed');
 assert.match(f.jobs[0].error,/绑定润丰/);assert.equal(f.jobs[0].snapshot.operation,'replace');
});
