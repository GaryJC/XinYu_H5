import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL||='postgresql://test:test@127.0.0.1:5432/test';
const {processInspectionNotifications}=await import('../server/workers/inspectionNotifications.mjs');
const env={APP_ENV:'test',DISPATCH_NOTIFICATION_MODE:'dingtalk',DINGTALK_AGENT_ID:'1',DINGTALK_APP_KEY:'test',DINGTALK_APP_SECRET:'test',DISPATCH_APP_URL:'https://example.com'};
const pending=()=>({shop_id:'s',technician_id:'worker',stage:'待检验',data:{technicianIds:['worker'],items:[{id:1,name:'检修',responsibleId:'worker',status:'待检验'}]}});
function fixture({snapshot=pending(),current=snapshot,latest=99,snapshotLatest=latest,snapshotLease=true,currentLease=true,onSync,ids=['inspector']}={}) {
  let lease,inTransaction=false,syncs=0,transactions=0;
  const calls=[];
  const db={async query(sql,params=[]) {
    calls.push({sql,params});
    if(sql.startsWith('with candidate')){lease=params[0];return {rows:[{event_id:99,order_id:'o'}]};}
    if(sql.includes('as notification_lease_id'))return {rows:[{...snapshot,order_id:'o',order_status:'维修中',latest_inspection_event_id:snapshotLatest,notification_lease_id:snapshotLease?lease:'other'}]};
    if(sql.includes('from work_orders'))return {rows:[{id:'o',status:'维修中',shop_id:current.shop_id}]};
    if(sql.includes('select * from dispatch_tasks'))return {rows:[current]};
    if(sql.includes('select lease_id'))return {rows:[{lease_id:currentLease?lease:'other'}]};
    if(sql.includes('select max(id)'))return {rows:[{id:latest}]};
    if(sql.includes('select id,name,role,active,shop_id'))return {rows:[{id:'inspector',name:'检验员',role:'inspector',shop_id:'s',active:true}]};
    return {rows:[],rowCount:1};
  }};
  return {calls,get syncs(){return syncs;},get transactions(){return transactions;},async run() {
    return processInspectionNotifications({database:db,env,runTransaction:async callback=>{
      transactions++;inTransaction=true;try{return await callback(db);}finally{inTransaction=false;}
    },sync:async shopId=>{
      assert.equal(inTransaction,false,'remote roster must not hold the transaction locks');
      assert.equal(shopId,'s');syncs++;await onSync?.(current);return ids;
    }});
  }};
}
const inserts=f=>f.calls.filter(c=>c.sql.includes('insert into dispatch_notifications'));
const updates=f=>f.calls.filter(c=>c.sql.startsWith('update dispatch_inspection_notifications'));

for(const [name,change] of [
  ['completed',row=>{row.stage='维修完成';}],
  ['claimed',row=>{row.inspector_id='inspector';}],
  ['outsourced',row=>{row.data.executionMode='outsourced';}],
  ['needs review',row=>{row.data.needsReview=true;}],
  ['no pending items',row=>{row.data.items[0].status='维修中';}]
]) test(`obsolete ${name} inspection jobs skip all remote discovery`,async()=>{
  const snapshot=pending();change(snapshot);
  const f=fixture({snapshot});await f.run();
  assert.equal(f.syncs,0);assert.equal(f.transactions,1);assert.equal(inserts(f).length,0);
  assert.equal(updates(f).length,1);assert.match(updates(f)[0].sql,/status='obsolete'/);
});
test('superseded inspection event skips discovery even if its task still needs inspection',async()=>{
  const f=fixture({latest:100});await f.run();
  assert.equal(f.syncs,0);assert.equal(inserts(f).length,0);assert.match(updates(f)[0].sql,/status='obsolete'/);
});
test('actionable notification resolves a live audience once with one transaction',async()=>{
  const f=fixture();await f.run();
  assert.equal(f.syncs,1);assert.equal(f.transactions,1);assert.equal(inserts(f).length,1);
  assert.equal(inserts(f)[0].params[3],'inspector');assert.match(updates(f)[0].sql,/status='ready'/);
  assert.equal(f.calls.length,10,'normal path keeps the original database round-trip count');
});
test('released claim between snapshot and lock requires live discovery outside locks',async()=>{
  const snapshot={...pending(),inspector_id:'inspector'};
  const f=fixture({snapshot,current:pending()});await f.run();
  assert.equal(f.syncs,1);assert.equal(f.transactions,2);assert.equal(inserts(f).length,1);
  const rosterRead=f.calls.findIndex(c=>c.sql.includes('select id,name,role,active,shop_id'));
  assert.equal(f.calls.slice(0,rosterRead).filter(c=>c.sql.includes('from work_orders where')).length,2);
});
test('task claimed during live discovery becomes obsolete without enqueuing',async()=>{
  const f=fixture({onSync:row=>{row.inspector_id='inspector';}});await f.run();
  assert.equal(f.syncs,1);assert.equal(inserts(f).length,0);assert.match(updates(f)[0].sql,/status='obsolete'/);
});
test('lease loss before snapshot skips remote discovery and all queue mutations',async()=>{
  const f=fixture({snapshotLease:false,currentLease:false});await f.run();
  assert.equal(f.syncs,0);assert.equal(inserts(f).length,0);assert.equal(updates(f).length,0);
});
test('lease loss after snapshot prevents enqueueing',async()=>{
  const f=fixture({currentLease:false});await f.run();
  assert.equal(f.syncs,1);assert.equal(inserts(f).length,0);assert.equal(updates(f).length,0);
});
test('shop changes cannot reuse the old shop audience',async()=>{
  const f=fixture({current:{...pending(),shop_id:'other'}});await f.run();
  assert.equal(inserts(f).length,0);assert.match(updates(f)[0].params[2],/门店已变化/);
});
for(const [name,options,error] of [
  ['empty',{ids:[]},/暂无本店/],
  ['malformed',{ids:null},/名单响应无效/],
  ['failed',{onSync:()=>{throw new Error('通讯录不可用');}},/通讯录不可用/]
]) test(`${name} live discovery cannot fall back to a local audience`,async()=>{
  const f=fixture(options);await f.run();
  assert.equal(f.syncs,1);assert.equal(inserts(f).length,0);
  assert.match(updates(f)[0].params[2],error);assert.match(updates(f)[0].sql,/lease_id=\$2/);
});
