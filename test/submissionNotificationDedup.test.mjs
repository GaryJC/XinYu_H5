import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:1/unused';
const {processInspectionNotifications}=await import('../server/workers/inspectionNotifications.mjs');
const {processSchedulerNotifications}=await import('../server/workers/schedulerNotifications.mjs');
const env={APP_ENV:'test',DISPATCH_NOTIFICATION_MODE:'mock'};
function fixture({kind='维修已提检',existing=[]}={}) {
 const notices=structuredClone(existing),leases={},queries=[];
 const people=[{id:'manager',role:'manager'},{id:'advisor',role:'advisor'},{id:'inspector',role:'inspector'},{id:'both',role:'advisor',roles:['advisor','inspector']},{id:'worker',role:'manager'}];
 const database={query:async(sql,params=[])=>{
  queries.push(sql);
  if(sql.startsWith('with candidate')) {
   const type=sql.includes('dispatch_inspection_notifications')?'inspection':'scheduler';leases[type]=params[0];
   return {rows:[{event_id:99,order_id:'o',kind,payload:{orderId:'o',actorName:'维修工'}}]};
  }
  if(sql.startsWith('select shop_id'))return {rows:[{shop_id:'s'}]};
  if(sql.includes('from work_orders'))return {rows:[{id:'o',shop_id:'s',vehicle_plate:'沪ATEST',status:'维修中'}]};
  if(sql.startsWith('select * from dispatch_tasks'))return {rows:[{stage:'待检验',shop_id:'s',technician_id:'worker',data:{items:[{id:1,name:'项目',status:'待检验',responsibleId:'worker'}],technicianIds:['worker']}}]};
  if(sql.startsWith('select lease_id'))return {rows:[{lease_id:leases[sql.includes('dispatch_inspection_notifications')?'inspection':'scheduler']}]};
  if(sql.startsWith('select max(id)'))return {rows:[{id:99}]};
  if(sql.startsWith('select id,name,role'))return {rows:people.map(p=>({...p,name:p.id,active:true,shop_id:'s'}))};
  if(sql.startsWith('select 1 from dispatch_notifications'))return {rows:notices.filter(n=>n.orderId===params[0]&&n.eventId===params[1]&&n.recipient===params[2]&&['维修已提检','回审已提交','待检验'].includes(n.kind)&&n.status!=='failed').slice(0,1)};
  if(sql.startsWith('insert into dispatch_notifications'))notices.push({orderId:params[1],eventId:params[2],recipient:params[3],kind:sql.includes("'待检验'")?'待检验':params[4],status:'pending'});
  return {rows:[]};
 }};
 const opts={database,runTransaction:fn=>fn(database),env};
 return {notices,queries,inspect:()=>processInspectionNotifications(opts),schedule:()=>processSchedulerNotifications(opts)};
}
for(const kind of ['维修已提检','回审已提交'])test(`${kind}: overlapping roles receive only the inspection notice`,async()=>{
 const f=fixture({kind});await f.inspect();await f.schedule();
 for(const id of ['manager','both'])assert.deepEqual(f.notices.filter(n=>n.recipient===id).map(n=>n.kind),['待检验']);
 assert.deepEqual(f.notices.filter(n=>n.recipient==='advisor').map(n=>n.kind),[kind]);
 assert.deepEqual(f.notices.filter(n=>n.recipient==='inspector').map(n=>n.kind),['待检验']);
 assert.deepEqual(f.notices.filter(n=>n.recipient==='worker').map(n=>n.kind),[kind]);
 assert.ok(f.queries.some(sql=>sql.includes('from work_orders')&&sql.includes('for update')));
});
test('delayed inspection fanout does not duplicate an already queued scheduler notice',async()=>{
 const f=fixture();await f.schedule();await f.inspect();
 for(const id of ['manager','both','advisor','inspector','worker'])assert.equal(f.notices.filter(n=>n.recipient===id).length,1);
});
test('pending, accepted, unknown and sent counterparts suppress a second notice, failed ones allow fallback',async()=>{
 for(const status of ['pending','accepted','unknown','sent','failed']) {
  const f=fixture({existing:[{orderId:'o',eventId:99,recipient:'manager',kind:'待检验',status}]});await f.schedule();
  assert.equal(f.notices.filter(n=>n.recipient==='manager'&&n.kind==='维修已提检').length,status==='failed'?1:0);
 }
});
test('different submissions and other notification kinds retain their notifications',async()=>{
 const f=fixture({existing:[{orderId:'o',eventId:98,recipient:'manager',kind:'待检验',status:'sent'}]});await f.inspect();await f.schedule();
 assert.equal(f.notices.filter(n=>n.recipient==='manager').length,2);
 for(const kind of ['无法接单','维修暂停']) {
  const other=fixture({kind});await other.inspect();await other.schedule();
  assert.ok(other.notices.some(n=>n.recipient==='manager'&&n.kind===kind));
 }
});
