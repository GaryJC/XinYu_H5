import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
const {executeDispatchActionInTransaction} = await import('../server/services/dispatchService.mjs');
const inspector={id:'inspector',name:'检验员',role:'inspector',shopId:'shop',active:true};
const task={orderId:'order',shopId:'shop',stage:'待开工',version:2,dueAt:'2026-10-22T08:00:00Z',technicianId:'worker',technicianIds:['worker'],items:[{id:1,name:'保养',status:'待开工',responsibleId:'worker'}]};
const body={action:'update-due',expectedVersion:2,requestId:'due-time-request',dueAt:'2026-10-23T10:00:00+08:00'};
function database(previous) {
  const calls=[];
  return {calls,async query(sql,params=[]) {
    calls.push({sql,params});
    if(sql.includes('from work_orders wo left join dispatch_tasks'))return {rows:[{order_id:'order',shop_id:'shop',order_status:'已委托',stage:task.stage,version:task.version,technician_id:'worker',data:task,repair_items:[]}]};
    if(sql.includes('select request_body from dispatch_events'))return {rows:previous?[{request_body:previous}]:[]};
    if(sql.includes('select id,name,role,active,shop_id'))return {rows:[{...inspector,shop_id:'shop'}]};
    if(sql.includes('insert into dispatch_events'))return {rows:[{id:99}]};
    return {rows:[],rowCount:1};
  }};
}
test('saving a due date records old/new dates and does not rewrite work order status, projects or notifications',async()=>{
  const db=database();
  await executeDispatchActionInTransaction(db,inspector,'order',body);
  const saved=db.calls.find(call=>call.sql.includes('insert into dispatch_tasks'));
  assert.equal(JSON.parse(saved.params[6]).dueAt,'2026-10-23T02:00:00.000Z');
  assert.equal(saved.params[4],'待开工');
  assert.equal(saved.params[5],3);
  const event=db.calls.find(call=>call.sql.includes('insert into dispatch_events'));
  const detail=JSON.parse(event.params[6]);
  assert.equal(detail.previousDueAt,task.dueAt);
  assert.equal(detail.dueAt,'2026-10-23T02:00:00.000Z');
  assert.equal(event.params[1],inspector.id);
  assert.ok(db.calls.some(call=>call.sql.includes('insert into audit_logs')));
  assert.ok(!db.calls.some(call=>/update work_orders set status|update repair_items|insert into dispatch_notifications|insert into dispatch_scheduler_notifications|insert into dispatch_inspection_notifications/.test(call.sql)));
});
test('retrying the same due-date request does not write twice; conflicting reuse is rejected',async()=>{
  const db=database(body);
  await executeDispatchActionInTransaction(db,inspector,'order',body);
  assert.ok(!db.calls.some(call=>/insert into|update work_orders/.test(call.sql)));
  await assert.rejects(()=>executeDispatchActionInTransaction(database(body),inspector,'order',{...body,dueAt:'2026-10-24T10:00:00+08:00'}),error=>error.status===409);
});
