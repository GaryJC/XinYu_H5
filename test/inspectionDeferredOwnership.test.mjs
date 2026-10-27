import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectionDeferredOwner} from '../shared/inspectionDeferredOwnership.mjs';
import {reconcileInspectionDeferred} from '../server/domain/inspectionDeferred.mjs';
process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:1/unused';
const {processInspectionDeferred}=await import('../server/services/inspectionDeferredService.mjs');
const {validateDeferredNotification}=await import('../server/repositories/inspectionDeferredRepository.mjs');
const {processNotification}=await import('../server/workers/dispatchNotifications.mjs');
const original={id:'original',name:'原检验员',role:'inspector',active:true,shopId:'s'};
const other={...original,id:'other',name:'其他检验员'};
const manager={...other,id:'manager',role:'manager'};
const tech={...original,id:'tech',name:'维修工',role:'technician'};
const entry=()=>({id:'p',itemId:2,name:'待定项目',source:'inspection',inspectionState:'pending',state:'pending',scheduled:false,lastOperationRequestId:'defer-001',history:[{action:'检验待定',actorId:original.id,actor:original.name,at:'2026-10-01',note:'暂缓'}],originalItem:{id:2,name:'待定项目',responsibleId:tech.id}});
function fixture({item=entry(),owner=original}={}) {
 const calls=[],notifications=[];
 const task={orderId:'o',shopId:'s',plate:'鲁B12345',stage:'维修中',version:1,technicianIds:[tech.id],items:[{id:1,name:'仍在维修',status:'维修中',responsibleId:tech.id}]};
 const row={version:1,items:[item]};
 const client={query:async(sql,args)=>{
  calls.push({sql,args});
  if(sql.includes('from work_orders wo left join'))return {rows:[{order_id:'o',shop_id:'s',vehicle_plate:task.plate,order_status:'维修中',technician_id:tech.id,inspector_id:other.id,stage:task.stage,version:1,repair_items:[],data:task}]};
  if(sql.startsWith('select id,name,role'))return {rows:[owner,other,manager,tech].map(p=>({...p,shop_id:p.shopId}))};
  if(sql.startsWith('insert into dispatch_events'))return {rows:[{id:123}]};
  if(sql.startsWith('insert into dispatch_notifications'))notifications.push({kind:args[4],recipient_id:args[3],payload:JSON.parse(args[5]),order_id:'o'});
  if(sql.startsWith('select snapshot'))return {rows:[{snapshot:{items:[{id:2,name:'【待定】待定项目',pendingConfirmation:true}]}}]};
  return {rows:[]};
 }};
 return {task,row,client,calls,notifications,run:(actor,action,extra={})=>processInspectionDeferred(client,actor,'o',{id:'p',action,requestId:'request-123',note:'不再维修',...extra},row)};
}
test('ownership uses latest deferring inspector, preserves old records, and never infers identity from a name',()=>{
 const item=entry();assert.deepEqual(inspectionDeferredOwner(item),{id:original.id,name:original.name});
 item.history.push({action:'检验待定',actorId:other.id,actor:other.name});
 assert.equal(inspectionDeferredOwner(item).id,other.id);
 assert.equal(inspectionDeferredOwner({history:[{action:'检验待定',actor:original.name}]}).id,undefined);
 const task={repairRound:2,items:[item.originalItem]};
 const next=reconcileInspectionDeferred([item],task,{items:[]},{deferredItemIds:[2],deferredReason:'再次待定',requestId:'again'},original,'now');
 assert.equal(next[0].sourceInspectorId,original.id);assert.equal(inspectionDeferredOwner(next[0]).id,original.id);
});
test('other inspectors and managers cannot dispatch, delete or cancel original inspector items',async()=>{
 for(const actor of [other,manager])for(const action of ['schedule','decline','cancel']) {
  const f=fixture();await assert.rejects(()=>f.run(actor,action),e=>e.status===403&&e.message.includes('原检验人'));
  assert.ok(!f.calls.some(c=>/^(insert|update|delete)/.test(c.sql)));
 }
 const f=fixture();await f.run(original,'decline');
 assert.ok(f.calls.some(c=>c.sql.startsWith('update work_orders set pending_repairs=')));
});
test('reminder queues exactly one task link recipient and leaves task and ownership unchanged',async()=>{
 const f=fixture();const result=await f.run(other,'remind-inspector');
 assert.equal(result.version,2);assert.equal(result.items[0].inspectionState,'pending');
 assert.equal(result.items[0].lastOperationRequestId,'defer-001');
 assert.equal(inspectionDeferredOwner(result.items[0]).id,original.id);
 assert.equal(f.notifications.length,1);assert.equal(f.notifications[0].recipient_id,original.id);
 assert.equal(f.notifications[0].payload.orderId,'o');assert.equal(f.notifications[0].kind,'待定项目处理提醒');
 assert.ok(!f.calls.some(c=>c.sql.includes('insert into dispatch_tasks')||c.sql.includes('insert into repair_writebacks')));
 const recent=fixture({item:result.items[0]});await assert.rejects(()=>recent.run(manager,'remind-inspector'),e=>e.status===409&&e.message.includes('刚刚'));
});
test('reminders reject closed items, missing owners, disabled owners and unauthorized senders',async()=>{
 for(const options of [{item:{...entry(),inspectionState:'completed'}},{item:{...entry(),history:[]}},{owner:{...original,active:false}},{owner:{...original,role:'advisor'}},{owner:{...original,shopId:'other'}}]) {
  const f=fixture(options);await assert.rejects(()=>f.run(other,'remind-inspector'),e=>e.status===409);assert.equal(f.notifications.length,0);
 }
 const f=fixture();await assert.rejects(()=>f.run(tech,'remind-inspector'),e=>e.status===403);
 await assert.rejects(()=>f.run(original,'remind-inspector'),e=>e.status===409);
});
test('delivery rechecks original inspector and pending state; obsolete reminders never send',async()=>{
 const f=fixture();await f.run(manager,'remind-inspector');const notification=f.notifications[0];
 let item=entry();
 const client={query:async()=>({rows:[{pending_repairs:[item],shop_id:'s',technician_id:tech.id,stage:'维修中',data:f.task}]})};
 assert.equal(await validateDeferredNotification(notification,original,client),true);
 assert.equal(await validateDeferredNotification(notification,other,client),false);
 assert.equal(await validateDeferredNotification(notification,{...original,active:false},client),false);
 item={...entry(),inspectionState:'cancelled'};assert.equal(await validateDeferredNotification(notification,original,client),false);
 item={...entry(),lastOperationRequestId:'new-deferral'};assert.equal(await validateDeferredNotification(notification,original,client),false);
 let sends=0,result;
 await processNotification({claim:async()=>({...notification,previous_status:'pending'}),recipient:async()=>original,validateDeferred:(row,user)=>validateDeferredNotification(row,user,client),send:async()=>{sends++;},finish:async(_,value)=>{result=value;}});
 assert.equal(sends,0);assert.equal(result.status,'failed');
});
