import test from 'node:test';
import assert from 'node:assert/strict';
import {recordVehicleNameplate,validateNameplateNotification} from '../server/repositories/vehicleNameplateRepository.mjs';
process.env.DATABASE_URL||='postgresql://test:test@127.0.0.1:5432/test';
const {processNotification}=await import('../server/workers/dispatchNotifications.mjs');
const task={orderId:'o',shopId:'s',plate:'测试车辆',vehicleNameplateFileId:'old'};
const actor={id:'t',name:'维修工'};
function database(previous=true) {
 const calls=[];
 return {calls,async query(sql,params){
  calls.push({sql,params});
  if(sql.includes('id<>$2'))return {rows:previous?[{id:'old'}]:[]};
  if(sql.startsWith('insert into dispatch_events'))return {rows:[{id:10}]};
  if(sql.startsWith('select id,role,roles')) {
   assert.match(sql,/active=true and shop_id=\$1/);assert.deepEqual(params,['s']);
   return {rows:[{id:'w',role:'warehouse'},{id:'multi',role:'advisor',roles:['advisor','warehouse']},{id:'t',role:'technician'}]};
  }
  return {rows:[]};
 }};
}
test('replacement atomically changes the current pointer and queues one notice per warehouse member',async()=>{
 const db=database();await recordVehicleNameplate(db,task,actor,'new','upload-123');
 const update=db.calls.find(c=>c.sql.startsWith('update dispatch_tasks'));
 assert.deepEqual(update.params,['o','new']);
 const notices=db.calls.filter(c=>c.sql.startsWith('insert into dispatch_notifications'));
 assert.deepEqual(notices.map(c=>c.params[3]),['w','multi']);
 for(const notice of notices){assert.equal(notice.params[4],'车辆铭牌已更新');assert.equal(JSON.parse(notice.params[5]).fileId,'new');}
 const event=db.calls.find(c=>c.sql.startsWith('insert into dispatch_events'));
 assert.deepEqual(JSON.parse(event.params[6]),{fileId:'new',previousFileId:'old'});
 assert.ok(!db.calls.some(c=>c.sql.startsWith('delete')));
});
test('first upload records the shared pointer without an update notice',async()=>{
 const db=database(false);await recordVehicleNameplate(db,{...task,vehicleNameplateFileId:undefined},actor,'first','upload-123');
 assert.ok(db.calls.some(c=>c.sql.startsWith('update dispatch_tasks')));
 assert.ok(!db.calls.some(c=>c.sql.startsWith('insert into dispatch_notifications')));
});
const notice={id:'n',order_id:'o',recipient_id:'w',kind:'车辆铭牌已更新',previous_status:'pending',payload:{orderId:'o',shopId:'s',fileId:'new'}};
const user={id:'w',role:'warehouse',active:true,shopId:'s',dingtalk_user_id:'ding-w'};
test('delivery rejects old photo notices and recipients who lose warehouse or shop access',async()=>{
 const current={query:async(sql,params)=>{assert.match(sql,/vehicleNameplateFileId/);assert.deepEqual(params,['o','s','new']);return {rows:[{exists:1}]};}};
 assert.equal(await validateNameplateNotification(notice,user,current),true);
 assert.equal(await validateNameplateNotification(notice,user,{query:async()=>({rows:[]})}),false);
 for(const patch of [{id:'other'},{active:false},{role:'technician'},{shopId:'else'}])assert.equal(await validateNameplateNotification(notice,{...user,...patch},{query:()=>assert.fail('unauthorized query')}),false);
});
test('notification worker applies the latest-nameplate guard before sending',async()=>{
 for(const valid of [true,false]) {
  let sent=0,result;
  await processNotification({claim:async()=>notice,recipient:async()=>user,validateNameplate:async()=>valid,send:async()=>{sent++;return {status:'accepted'};},finish:async(_row,value)=>{result=value;}});
  assert.equal(sent,valid?1:0);assert.equal(result.status,valid?'accepted':'failed');
 }
});
