import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
process.env.DATABASE_URL||='postgresql://test:test@127.0.0.1:5432/test';
const {executeDispatchActionInTransaction}=await import('../server/services/dispatchService.mjs');
const {processInspectionNotifications}=await import('../server/workers/inspectionNotifications.mjs');
const {processNotification}=await import('../server/workers/dispatchNotifications.mjs');
const tech={id:'t',name:'技师',role:'technician',shopId:'s',active:true};
const tech2={...tech,id:'t2',name:'技师二'};
const inspector={...tech,id:'i',name:'检验员',role:'inspector'};
const people=[tech,tech2,inspector];
function database(task,{photo=true}={}) {
 const calls=[];
 return {calls,async query(sql,params=[]) {
  calls.push({sql,params});
  if(sql.includes('from work_orders wo left join dispatch_tasks'))return {rows:[{order_id:'o',shop_id:'s',order_status:'维修中',stage:task.stage,version:task.version,technician_id:'t',data:task,repair_items:[]}]};
  if(sql.includes('select id,name,role,active,shop_id'))return {rows:people.map(p=>({...p,shop_id:p.shopId}))};
  if(sql.includes('select 1 from files'))return {rows:photo?[{}]:[]};
  if(sql.includes('insert into dispatch_events'))return {rows:[{id:99}]};
  return {rows:[],rowCount:1};
 }};
}
const initial=()=>({orderId:'o',shopId:'s',stage:'待检验',version:1,technicianId:'t',technicianIds:['t','t2'],items:[{id:1,name:'项目一',responsibleId:'t',status:'待检验'},{id:2,name:'项目二',responsibleId:'t2',status:'待检验'}]});
const input=(task,action)=>({action,expectedVersion:task.version,requestId:randomUUID()});
const queued=(db,table)=>db.calls.filter(c=>c.sql.includes(`insert into ${table}(`));
test('sending review queues a notification for each worker with task link data and instructions',async()=>{
 const task=initial(),db=database(task);
 await executeDispatchActionInTransaction(db,inspector,'o',{...input(task,'send-review'),note:'请核对项目名称'});
 const notices=queued(db,'dispatch_notifications');
 assert.equal(notices.length,2);
 assert.deepEqual(notices.map(n=>n.params[3]).sort(),['t','t2']);
 for(const n of notices) {
  assert.equal(n.params[4],'维修单回审');const payload=JSON.parse(n.params[5]);
  assert.equal(payload.orderId,'o');assert.match(payload.notice,/提交回审/);assert.equal(payload.reason,'请核对项目名称');
 }
 assert.equal(queued(db,'dispatch_inspection_notifications').length,0);
});
test('partial review submission stays quiet; final submission queues inspector and scheduler notifications',async()=>{
 const task=initial();task.stage='回审';task.items.forEach(i=>i.status='维修中');
 let db=database(task);
 await executeDispatchActionInTransaction(db,tech,'o',input(task,'submit-review'));
 assert.equal(queued(db,'dispatch_inspection_notifications').length,0);
 assert.equal(queued(db,'dispatch_scheduler_notifications').length,0);
 task.items[0].status='待检验';task.workerSubmissions={t:{at:'now',note:''}};
 db=database(task);
 await executeDispatchActionInTransaction(db,tech2,'o',input(task,'submit-review'));
 assert.equal(queued(db,'dispatch_inspection_notifications').length,1);
 const sched=queued(db,'dispatch_scheduler_notifications');assert.equal(sched.length,1);assert.equal(sched[0].params[2],'回审已提交');
 const missingPhoto=database(task,{photo:false});
 await assert.rejects(()=>executeDispatchActionInTransaction(missingPhoto,tech2,'o',input(task,'submit-review')),/维修照片/);
 assert.equal(queued(missingPhoto,'dispatch_inspection_notifications').length,0);
});
for(const mode of ['mock','dingtalk']) test(`inspection worker includes independent managers in ${mode} mode`,async()=>{
 const task=initial();const calls=[];
 const manager={...inspector,id:'manager',role:'manager',inspectorRoleMember:false};
 const audience=[...people,manager,{...manager,id:'disabled',active:false},{...manager,id:'other',shopId:'other'},
  {...manager,id:'participant'},{...manager,id:'responsible'},{...manager,id:'revoked'}];
 task.participantIds=['participant'];task.items.push({id:3,status:'待检验',responsibleId:'responsible'});

 const db={async query(sql,params=[]) {
  calls.push({sql,params});
  if(sql.startsWith('with candidate'))return {rows:[{event_id:99,order_id:'o',lease_id:'lease'}]};
  if(sql.includes('select shop_id'))return {rows:[{shop_id:'s'}]};
  if(sql.includes('from work_orders'))return {rows:[{id:'o',vehicle_plate:'沪ATEST',shop_id:'s',status:'维修中'}]};
  if(sql.includes('select * from dispatch_tasks'))return {rows:[{shop_id:'s',technician_id:'t',stage:'待检验',data:task}]};
  // The worker uses its generated lease to claim and then verify ownership.
  if(sql.includes('select lease_id'))return {rows:[{lease_id:calls[0].params[0]}]};
  if(sql.includes('select max(id)')){assert.match(sql,/'submit-review'/);return {rows:[{id:99}]};}
  if(sql.includes('select id,name,role,active,shop_id'))return {rows:audience.map(p=>({...p,shop_id:p.shopId}))};
  return {rows:[],rowCount:1};
 }};
 await processInspectionNotifications({database:db,runTransaction:callback=>callback(db),sync:async()=>audience.filter(p=>p.id!=='revoked').map(p=>p.id),env:{APP_ENV:'test',DISPATCH_NOTIFICATION_MODE:mode,DINGTALK_AGENT_ID:'1',DINGTALK_APP_KEY:'test',DINGTALK_APP_SECRET:'test',DISPATCH_APP_URL:'https://example.com'}});
 const notices=calls.filter(c=>c.sql.includes('insert into dispatch_notifications'));
 assert.deepEqual(notices.map(n=>n.params[3]),mode==='mock'?['i','manager','revoked']:['i','manager']);
});
test('review scheduler notices recheck recipients before delivery and use the existing retry path',async()=>{
 const row={id:'n',kind:'回审已提交',previous_status:'pending',recipient_id:'a',attempts:1,payload:{orderId:'o'}};
 let sent=false,finished;
 await processNotification({claim:async()=>row,recipient:async()=>({active:true,role:'advisor'}),validateScheduler:async()=>false,send:async()=>{sent=true;},finish:async(_row,result)=>{finished=result;}});
 assert.equal(sent,false);assert.equal(finished.status,'failed');assert.equal(finished.retryable,false);
});
