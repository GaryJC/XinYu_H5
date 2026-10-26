import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {applyDispatchAction} from '../server/domain/dispatchPolicy.mjs';
import {partsSubmissionNotifications} from '../server/domain/partsSubmissionNotifications.mjs';
import {validatePartsPickupNotification} from '../server/repositories/partsRequirementRepository.mjs';
import {messageBody} from '../server/integrations/dingtalk/notifications.mjs';
process.env.DATABASE_URL||='postgresql://test:test@127.0.0.1:5432/test';
const {executeDispatchActionInTransaction}=await import('../server/services/dispatchService.mjs');
const {processNotification}=await import('../server/workers/dispatchNotifications.mjs');
const tech={id:'t',name:'维修甲',role:'technician',shopId:'s',active:true};
const warehouse={...tech,id:'w',name:'仓管',role:'warehouse'};
const people=[tech,warehouse,{...warehouse,id:'w2',role:'advisor',roles:['advisor','warehouse']},{...warehouse,id:'disabled',active:false}];
const parts=()=>({mode:'list',ownerId:'t',ownerName:'维修甲',recordedAt:'old',revision:1,batch:1,items:[{name:'滤芯',quantity:1,unit:'个'},{name:'耗材',quantity:2,unit:'片'}],photoIds:[]});
const initial=()=>({orderId:'o',shopId:'s',orderStatus:'维修中',plate:'沪ATEST',stage:'待开工',acceptedAt:'accepted',version:1,technicianId:'t',technicianIds:['t'],partsRequests:[parts()],items:[{id:1,name:'保养项目',responsibleId:'t',status:'待开工'}]});
const request=(task,requirement)=>({action:'record-parts',expectedVersion:task.version,requestId:randomUUID(),partsRequirement:requirement});
function database(task,{previous}={}) {
 const calls=[];
 return {calls,async query(sql,params=[]) {
  calls.push({sql,params});
  if(sql.includes('from work_orders wo left join dispatch_tasks'))return {rows:[{order_id:'o',shop_id:'s',order_status:'维修中',stage:task.stage,version:task.version,technician_id:'t',data:task,repair_items:[]}]};
  if(sql.includes('select request_body'))return {rows:previous?[{request_body:previous}]:[]};
  if(sql.includes('select id,name,role,active,shop_id'))return {rows:people.map(p=>({...p,shop_id:p.shopId}))};
  if(sql.includes('insert into dispatch_events'))return {rows:[{id:99}]};
  return {rows:[],rowCount:1};
 }};
}
const queued=db=>db.calls.filter(c=>c.sql.includes('insert into dispatch_notifications(')).map(c=>({order_id:c.params[1],recipient_id:c.params[3],kind:c.params[4],payload:JSON.parse(c.params[5])}));
const stored=db=>JSON.parse(db.calls.find(c=>c.sql.includes('insert into dispatch_events')).params[6]).partsRequirement;
const validator=(task,requirement)=>({query:async()=>({rows:[{stage:task.stage,technician_id:'t',data:{...task,partsRequests:[requirement]}}]})});

test('resubmission queues latest parts and edit instructions for every active warehouse member',async()=>{
 const task=initial(),db=database(task),input=request(task,{mode:'list',items:[{name:'新滤芯',quantity:3,unit:'个'}]});
 await executeDispatchActionInTransaction(db,tech,'o',input);
 const rows=queued(db);assert.deepEqual(rows.map(r=>r.recipient_id),['w','w2']);
 for(const row of rows) {
  assert.equal(row.kind,'配件申请已更新');assert.match(row.payload.summary,/维修甲：新滤芯 3个/);assert.doesNotMatch(row.payload.summary,/保养项目/);
  assert.match(row.payload.notice,/重新提交/);assert.equal(row.payload.partsOwnerId,'t');assert.equal(row.payload.partsRevision,2);
  assert.equal(await validatePartsPickupNotification(row,people.find(p=>p.id===row.recipient_id),validator(task,stored(db))),true);
 }
 const body=messageBody(rows[0],'ding-w',{DISPATCH_APP_URL:'https://example.com',DINGTALK_AGENT_ID:'1'});
 assert.match(body.msg.markdown.title,/配件申请已更新/);assert.match(body.msg.markdown.text,/新滤芯 3个/);assert.match(body.msg.markdown.text,/dispatchOrder=o/);
});

test('changing request to no parts still notifies warehouse to stop preparing the old list',async()=>{
 const task=initial(),db=database(task);
 await executeDispatchActionInTransaction(db,tech,'o',request(task,{mode:'none'}));
 const rows=queued(db);assert.equal(rows.length,2);assert.match(rows[0].payload.notice,/停止按原清单备料/);
 assert.equal(await validatePartsPickupNotification(rows[0],warehouse,validator({...task,stage:'维修中'},stored(db))),true);
});

test('partial preparation edits refresh pickup indices and notify warehouse even after last pending line removal',async()=>{
 for(const retainPending of [true,false]) {
  const task=initial();task.partsRequests[0].items[1]={...task.partsRequests[0].items[1],preparedAt:'prepared',preparedBy:'w',preparedName:'仓管',recipientId:'t',recipientName:'维修甲'};
  const retained=task.partsRequests[0].items[1];
  const db=database(task);
  await executeDispatchActionInTransaction(db,tech,'o',request(task,{mode:'list',items:[retained,...(retainPending?[{name:'新增件',quantity:1,unit:'个'}]:[])]}));
  const rows=queued(db);assert.equal(rows.filter(r=>r.kind==='配件申请已更新').length,2);
  const pickup=rows.find(r=>r.kind==='配件可领取');assert.deepEqual(pickup.payload.partsPreparation,[{index:0,preparedAt:'prepared'}]);
  assert.equal(await validatePartsPickupNotification(pickup,tech,validator(task,stored(db))),true);
  assert.match(pickup.payload.summary,/耗材 2片/);assert.doesNotMatch(pickup.payload.summary,/新增件/);
  if(!retainPending)assert.match(rows[0].payload.notice,/已无待备料项/);
 }
});

test('new and supplemental applications retain normal warehouse notifications; none at acceptance is quiet',()=>{
 for(const previous of [undefined,{...parts(),preparedAt:'ready'}]) {
  const task=initial();task.partsRequests=previous?[previous]:[];
  const input=request(task,{mode:'list',items:[{name:'补料',quantity:1,unit:'个'}]});
  const next=applyDispatchAction(task,input,tech,people);
  const rows=partsSubmissionNotifications(task,next,input,tech,[...people,{...warehouse,id:'other',shopId:'other'}]);
  assert.deepEqual(rows.map(r=>r.kind),['配件申请','配件申请']);
 }
 const task={...initial(),stage:'待接单',partsRequests:[],acceptedAt:undefined};
 const input={...request(task,{mode:'none'}),action:'accept'};
 assert.deepEqual(partsSubmissionNotifications(task,applyDispatchAction(task,input,tech,people),input,tech,people),[]);
});

test('replayed submissions and stale writes never enqueue duplicate or misleading notifications',async()=>{
 const task=initial(),input=request(task,{mode:'none'}),replay=database(task,{previous:input});
 await executeDispatchActionInTransaction(replay,tech,'o',input);assert.deepEqual(queued(replay),[]);
 const stale=database(task);await assert.rejects(()=>executeDispatchActionInTransaction(stale,tech,'o',{...input,expectedVersion:0}),e=>e.status===409);assert.deepEqual(queued(stale),[]);
});

test('warehouse delivery rejects stale revisions, rounds, roles and inactive workflows; failures retry',async()=>{
 const task=initial(),row={order_id:'o',recipient_id:'w',kind:'配件申请已更新',previous_status:'pending',payload:{shopId:'s',repairRound:0,partsOwnerId:'t',partsRecordedAt:'old',partsRevision:1}};
 const check=(r=row,t=task,u=warehouse)=>validatePartsPickupNotification(r,u,validator(t,t.partsRequests[0]));
 assert.equal(await check(),true);
 for(const patch of [{partsRevision:0},{partsRecordedAt:'stale'},{partsOwnerId:'other'},{repairRound:1}])assert.equal(await check({...row,payload:{...row.payload,...patch}}),false);
 for(const stage of ['待接单','待检验','维修完成'])assert.equal(await check(row,{...task,stage}),false);
 for(const patch of [{active:false},{role:'technician'},{shopId:'other'},{id:'other'}])assert.equal(await check(row,task,{...warehouse,...patch}),false);
 const none={...task,partsRequests:[{...parts(),mode:'none',items:[]}]};
 assert.equal(await check({...row,kind:'配件申请'},none),false);assert.equal(await check(row,none),true);
 let sent=0,result;
 const deps={claim:async()=>row,recipient:async()=>warehouse,send:async()=>{sent++;return {status:'accepted',taskId:'mock-id'};},finish:async(_,r)=>{result=r;}};
 await processNotification({...deps,validateParts:async()=>false});assert.equal(sent,0);assert.equal(result.retryable,false);
 await processNotification({...deps,validateParts:async()=>{throw Error('database down');}});assert.equal(sent,0);assert.equal(result.retryable,true);
 await processNotification({...deps,validateParts:()=>check()});assert.equal(sent,1);assert.equal(result.status,'accepted');
});
