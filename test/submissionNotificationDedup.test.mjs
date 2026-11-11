import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:1/unused';
const {processInspectionNotifications}=await import('../server/workers/inspectionNotifications.mjs');
const {processSchedulerNotifications}=await import('../server/workers/schedulerNotifications.mjs');
const env={APP_ENV:'test',DISPATCH_NOTIFICATION_MODE:'mock'};
function fixture({kind='维修已提检',existing=[],leaseValid=true,mode='mock'}={}) {
 const notices=structuredClone(existing),leases={},queries=[];let syncs=0;
 const people=[{id:'manager',role:'manager'},{id:'advisor',role:'advisor'},{id:'inspector',role:'inspector'},{id:'both',role:'advisor',roles:['advisor','inspector']},{id:'worker',role:'manager'}];
 const database={query:async(sql,params=[])=>{
  queries.push(sql);
  if(sql.startsWith('with candidate')) {
   const type=sql.includes('dispatch_inspection_notifications')?'inspection':'scheduler';leases[type]=params[0];
   return {rows:[{event_id:99,order_id:'o',kind,payload:{orderId:'o',actorName:'维修工'}}]};
  }
  if(sql.includes('as notification_lease_id'))return {rows:[{order_id:'o',stage:'待检验',order_status:'维修中',shop_id:'s',technician_id:'worker',data:{items:[{id:1,name:'项目',status:'待检验',responsibleId:'worker'}],technicianIds:['worker']},latest_inspection_event_id:99,notification_lease_id:leases.inspection}]};
  if(sql.startsWith('select shop_id'))return {rows:[{shop_id:'s'}]};
  if(sql.startsWith('select id from users where active'))return {rows:[{id:'advisor'}]};
  if(sql.includes('from work_orders'))return {rows:[{id:'o',advisor:'advisor',shop_id:'s',vehicle_plate:'沪ATEST',status:'维修中'}]};
  if(sql.startsWith('select * from dispatch_tasks'))return {rows:[{stage:'待检验',shop_id:'s',technician_id:'worker',data:{items:[{id:1,name:'项目',status:'待检验',responsibleId:'worker'}],technicianIds:['worker']}}]};
  if(sql.startsWith('select lease_id'))return {rows:[{lease_id:leaseValid?leases[sql.includes('dispatch_inspection_notifications')?'inspection':'scheduler']:'other'}]};
  if(sql.startsWith('select max(id)'))return {rows:[{id:99}]};
  if(sql.startsWith('select id,name,role'))return {rows:people.map(p=>({...p,name:p.id,active:true,shop_id:'s'}))};
  if(sql.startsWith('select 1 from dispatch_notifications'))return {rows:notices.filter(n=>n.orderId===params[0]&&n.eventId===params[1]&&n.recipient===params[2]&&['维修已提检','回审已提交','待检验'].includes(n.kind)&&n.status!=='failed').slice(0,1)};
  if(sql.startsWith('insert into dispatch_notifications'))notices.push({orderId:params[1],eventId:params[2],recipient:params[3],kind:sql.includes("'待检验'")?'待检验':params[4],status:'pending'});
  return {rows:[]};
 }};
 const opts={database,runTransaction:fn=>fn(database),env:{...env,DISPATCH_NOTIFICATION_MODE:mode,DINGTALK_AGENT_ID:'1',DINGTALK_APP_KEY:'key',DINGTALK_APP_SECRET:'secret',DISPATCH_APP_URL:'https://example.com'},sync:async()=>{syncs++;return people.map(p=>p.id);}};
 return {notices,queries,get syncs(){return syncs;},inspect:()=>processInspectionNotifications(opts),schedule:()=>processSchedulerNotifications(opts)};
}
for(const kind of ['维修已提检','回审已提交'])test(`${kind}: legacy scheduler jobs move to inspector-only delivery without roster reads`,async()=>{
 const f=fixture({kind,mode:'dingtalk'});await f.schedule();
 assert.equal(f.syncs,0);assert.deepEqual(f.notices,[]);
 assert.equal(f.queries.filter(sql=>sql.startsWith('insert into dispatch_inspection_notifications')).length,1);
 assert.ok(f.queries.some(sql=>sql.includes('insert into dispatch_inspection_notifications')&&sql.includes('on conflict do nothing')));
 await f.inspect();
 assert.deepEqual(f.notices.map(n=>n.recipient).sort(),['both','inspector']);
 assert.ok(f.notices.every(n=>n.kind==='待检验'));
 assert.ok(f.queries.some(sql=>sql.includes('from work_orders')&&sql.includes('for update')));
});
test('inspection completed before legacy scheduler migration does not add a second recipient notice',async()=>{
 const f=fixture();await f.inspect();await f.schedule();await f.inspect();
 assert.deepEqual(f.notices.map(n=>n.recipient).sort(),['both','inspector']);
});
test('pending, accepted, unknown and sent counterparts suppress a second notice, failed ones allow fallback',async()=>{
 for(const status of ['pending','accepted','unknown','sent','failed']) {
  const f=fixture({existing:[{orderId:'o',eventId:99,recipient:'inspector',kind:'维修已提检',status}]});await f.inspect();
  assert.equal(f.notices.filter(n=>n.recipient==='inspector'&&n.kind==='待检验').length,status==='failed'?1:0);
 }
});
test('legacy scheduler notices for plain managers cannot suppress real inspector notifications',async()=>{
 const f=fixture({existing:[{orderId:'o',eventId:99,recipient:'manager',kind:'维修已提检',status:'pending'}]});await f.inspect();
 assert.deepEqual(f.notices.filter(n=>n.kind==='待检验').map(n=>n.recipient).sort(),['both','inspector']);
});
test('different submissions and non-submission scheduler kinds retain their notifications',async()=>{
 const f=fixture({existing:[{orderId:'o',eventId:98,recipient:'inspector',kind:'待检验',status:'sent'}]});await f.inspect();await f.schedule();
 assert.equal(f.notices.filter(n=>n.recipient==='inspector').length,2);
 for(const kind of ['无法接单']) {
  const other=fixture({kind});await other.inspect();await other.schedule();
  assert.ok(!other.notices.some(n=>n.recipient==='manager'&&n.kind===kind));
  assert.ok(other.notices.some(n=>n.recipient==='advisor'&&n.kind===kind));
 }
});
test('retired pause jobs are suppressed before roster reads or fanout',async()=>{
 const f=fixture({kind:'维修暂停',mode:'dingtalk'});await f.schedule();
 assert.equal(f.syncs,0);assert.deepEqual(f.notices,[]);
 assert.equal(f.queries.length,2,'claim and terminal update only; no people or task reads');
 assert.match(f.queries[1],/status='suppressed'/);
 assert.match(f.queries[1],/lease_id=\$2/);
});
test('legacy scheduler lease loss cannot enqueue or acknowledge an inspector job',async()=>{
 const f=fixture({leaseValid:false});await f.schedule();
 assert.equal(f.syncs,0);assert.deepEqual(f.notices,[]);
 assert.equal(f.queries.filter(sql=>sql.startsWith('insert into')||sql.startsWith('update dispatch_scheduler_notifications')).length,0);
});
