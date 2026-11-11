import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {currentPartsNotification,validatePartsPickupNotification} from '../server/repositories/partsRequirementRepository.mjs';
import {dueReminderRecipients,isCurrentDueReminder} from '../server/domain/dueReminderPolicy.mjs';
process.env.DATABASE_URL||='postgresql://test:test@127.0.0.1:5432/test';
const {executeDispatchActionInTransaction}=await import('../server/services/dispatchService.mjs');
const {processNotification}=await import('../server/workers/dispatchNotifications.mjs');
const {validateDueReminder}=await import('../server/workers/dueReminders.mjs');
const tech={id:'a',name:'甲',role:'technician',shopId:'s',active:true};
const other={...tech,id:'b',name:'乙'};
const warehouse={...tech,id:'w',name:'仓管',role:'warehouse'};
const people=[tech,other,warehouse];
const initial=()=>({orderId:'o',shopId:'s',orderStatus:'维修中',stage:'待开工',acceptedAt:'accepted',version:1,technicianId:'a',technicianIds:['a','b'],items:[{id:1,name:'保养',responsibleId:'a',status:'待开工'},{id:2,name:'检查',responsibleId:'b',status:'待开工'}],partsRequests:[{mode:'list',ownerId:'a',ownerName:'甲',recordedAt:'recorded',revision:1,items:[{name:'滤芯',quantity:1,unit:'个'},{name:'刹车片',quantity:2,unit:'片'},{name:'机油',quantity:3,unit:'升'}],photoIds:[]}]});
function database(task) {
 const calls=[];return {calls,async query(sql,params=[]) {
  calls.push({sql,params});
  if(sql.includes('from work_orders wo left join dispatch_tasks'))return {rows:[{order_id:'o',shop_id:'s',order_status:'维修中',stage:task.stage,version:task.version,technician_id:'a',data:task,repair_items:[]}]};
  if(sql.includes('select request_body'))return {rows:[]};
  if(sql.includes('select id,name,role,active,shop_id'))return {rows:people.map(p=>({...p,shop_id:p.shopId}))};
  if(sql.includes('insert into dispatch_events'))return {rows:[{id:2}]};
  return {rows:[],rowCount:1};
 }};
}
const queued=db=>db.calls.filter(c=>c.sql.includes('insert into dispatch_notifications(')).map(c=>({order_id:c.params[1],recipient_id:c.params[3],kind:c.params[4],payload:JSON.parse(c.params[5])}));
const stored=(db,previous)=>{const save=db.calls.find(c=>c.sql.includes('insert into dispatch_tasks('));return {...previous,...JSON.parse(save.params[6]),stage:save.params[4],version:save.params[5]};};
const read=task=>({query:async()=>({rows:[{stage:task.stage,technician_id:'a',data:task}]})});
async function partialHandover(grouped) {
 const task=initial(),rows=[{index:0,recipientId:'a'},{index:1,recipientId:'a'}];
 const prepare={action:'confirm-parts',expectedVersion:task.version,requestId:randomUUID(),...(grouped?{preparationGroups:[{partsOwnerId:'a',items:rows}]}:{partsOwnerId:'a',partsPreparation:rows})};
 const db=database(task);await executeDispatchActionInTransaction(db,warehouse,'o',prepare);
 const notice=queued(db).find(row=>row.kind==='配件可领取'),prepared=stored(db,task);
 const issueDb=database(prepared);
 await executeDispatchActionInTransaction(issueDb,warehouse,'o',{action:'issue-parts',partsOwnerId:'a',partsIssue:[{index:0,recipientId:'a'}],expectedVersion:prepared.version,requestId:randomUUID()});
 return {notice,task:stored(issueDb,prepared)};
}

for(const grouped of [false,true])test(`${grouped?'grouped':'single-request'} queued pickup keeps remaining lines after a partial handover`,async()=>{
 const {notice,task}=await partialHandover(grouped),before=structuredClone(notice);
 assert.equal(task.partsRequests[0].items[1].issuedAt,undefined);
 assert.equal(await validatePartsPickupNotification(notice,tech,read(task)),true);
 const current=await currentPartsNotification(notice,tech,read(task));
 assert.equal(current.payload.summary,'刹车片 2片');
 assert.deepEqual((grouped?current.payload.preparationGroups[0].items:current.payload.partsPreparation).map(row=>row.index),[1]);
 assert.deepEqual(notice,before,'delivery projection must not mutate persisted notification evidence');
 let delivered,result;
 await processNotification({claim:async()=>({...notice,previous_status:'pending'}),recipient:async()=>tech,validateParts:(row,user)=>currentPartsNotification(row,user,read(task)),send:async row=>{delivered=row;return {status:'sent'};},finish:async(_,value)=>{result=value;}});
 assert.equal(delivered.payload.summary,'刹车片 2片');assert.equal(result.status,'sent');
 task.partsRequests[0].items[1].issuedAt='issued-later';
 delivered=undefined;
 await processNotification({claim:async()=>({...notice,previous_status:'pending'}),recipient:async()=>tech,validateParts:(row,user)=>currentPartsNotification(row,user,read(task)),send:async row=>{delivered=row;return {status:'sent'};},finish:async(_,value)=>{result=value;}});
 assert.equal(delivered,undefined);assert.equal(result.status,'failed');assert.equal(result.retryable,false);
});

test('pickup selection remains index-specific for duplicate names and never adds later preparation',async()=>{
 const {notice,task}=await partialHandover(false),parts=task.partsRequests[0];
 parts.items[0].name='滤芯';parts.items[1].name='滤芯';
 Object.assign(parts.items[2],{preparedAt:'later',recipientId:'a'});
 const current=await currentPartsNotification(notice,tech,read(task));
 assert.equal(current.payload.summary,'滤芯 2片');
 assert.deepEqual(current.payload.partsPreparation.map(row=>row.index),[1]);
});

for(const grouped of [false,true])test(`${grouped?'grouped':'single-request'} pickup drops reassigned, stale revision and later-round material`,async()=>{
 const {notice,task}=await partialHandover(grouped);
 for(const mutate of [t=>{t.partsRequests[0].items[1].recipientId='b';},t=>{t.partsRequests[0].items[1].preparedAt='new-preparation';},t=>{t.partsRequests[0].revision++;},t=>{t.partsRequests[0].recordedAt='new-request';},t=>{t.repairRound=1;},t=>{t.technicianIds=['b'];}]) {
  const changed=structuredClone(task);mutate(changed);
  assert.equal(await validatePartsPickupNotification(notice,tech,read(changed)),false);
 }
});

test('a stale grouped request does not cancel another unchanged request in the same pickup notice',async()=>{
 const {notice,task}=await partialHandover(true),shared=structuredClone(task.partsRequests[0]);
 delete shared.ownerId;shared.items=[{name:'共同耗材',quantity:1,unit:'盒',recipientId:'a',preparedAt:'shared-ready'}];
 task.partsRequirement=shared;
 notice.payload.preparationGroups.push({partsRecordedAt:shared.recordedAt,partsRevision:shared.revision,items:[{index:0,preparedAt:'shared-ready'}]});
 task.partsRequests[0].revision++;
 const current=await currentPartsNotification(notice,tech,read(task));
 assert.equal(current.payload.summary,'共同耗材 1盒');
 assert.equal(current.payload.preparationGroups.length,1);assert.equal(current.payload.preparationGroups[0].partsOwnerId,undefined);
});

test('legacy whole-batch pickup keeps only unissued eligible lines and still rejects a replaced batch',async()=>{
 const {notice,task}=await partialHandover(false),parts=task.partsRequests[0];
 delete notice.payload.partsPreparation;
 parts.preparedAt='batch-ready';parts.items[2].recipientId='b';
 assert.equal((await currentPartsNotification(notice,tech,read(task))).payload.summary,'刹车片 2片');
 parts.items[1].issuedAt='issued';
 assert.equal(await validatePartsPickupNotification(notice,tech,read(task)),false);
 parts.items[1].issuedAt=undefined;parts.revision++;
 assert.equal(await validatePartsPickupNotification(notice,tech,read(task)),false);
});

test('photo-only pickup retains the existing message until the batch is issued',async()=>{
 const {notice,task}=await partialHandover(false),parts=task.partsRequests[0];
 delete notice.payload.partsPreparation;
 Object.assign(parts,{mode:'photo',items:[],photoIds:['photo'],preparedAt:'batch-ready'});
 assert.deepEqual(await currentPartsNotification(notice,tech,read(task)),notice);
 parts.issuedAt='issued';assert.equal(await validatePartsPickupNotification(notice,tech,read(task)),false);
});

const reminderTime=Date.parse('2026-11-04T00:00:00Z');
const dueTask=()=>({...initial(),stage:'维修中',dueAt:new Date(reminderTime+1800000).toISOString(),workerSubmissions:{a:{at:'submitted'}},items:[{id:1,name:'甲的保养',responsibleId:'a',status:'待检验'},{id:2,name:'乙的检查',responsibleId:'b',status:'待开工'}]});
const reminder=task=>({order_id:'o',recipient_id:'a',kind:'即将到期',previous_status:'pending',payload:{dueAt:task.dueAt,leadMinutes:60}});
const reminderDatabase=task=>({query:async()=>({rows:[{order_id:'o',shop_id:'s',order_status:task.orderStatus,stage:task.stage,technician_id:'a',data:task,repair_items:[]}]})});

test('upcoming notices target unfinished workers and cancel queued delivery after personal submission or inspection',async()=>{
 for(const status of ['待检验','已完工']) {
  const task=dueTask();task.items[0].status=status;
  assert.deepEqual(dueReminderRecipients(task,[tech,other],reminderTime).map(p=>p.id),['b']);
  assert.equal(isCurrentDueReminder(task,reminder(task),tech,reminderTime),false);
  let sent=false,result;
  await processNotification({claim:async()=>reminder(task),recipient:async()=>tech,validateDue:(row,user)=>validateDueReminder(row,user,{database:reminderDatabase(task),now:reminderTime}),send:async()=>{sent=true;return {status:'sent'};},finish:async(_,value)=>{result=value;}});
  assert.equal(sent,false);assert.equal(result.status,'suppressed');assert.notEqual(result.retryable,true);
 }
});

test('legacy eligible additions and pauses no longer pass delivery validation',async()=>{
 for(const status of ['待派工','待领料','待开工','维修中']) {
  const task=dueTask();task.items.push({id:3,responsibleId:'a',status});
  assert.deepEqual(dueReminderRecipients(task,[tech,other],reminderTime).map(p=>p.id),['a','b']);
  assert.equal(await validateDueReminder(reminder(task),tech,{database:reminderDatabase(task),now:reminderTime}),false);
 }
 for(const global of [false,true]) {
  const task=dueTask();task.items[0].status='维修中';
  if(global)task.stage='暂停';else task.workerPauses={a:{resumeStage:'维修中'}};
  assert.equal(isCurrentDueReminder(task,reminder(task),tech,reminderTime),true);
  task.items[0].status='待检验';
  assert.equal(isCurrentDueReminder(task,reminder(task),tech,reminderTime),false);
 }
});

test('legacy unsubmitted completion and missing owner items retain reminder behavior; role and external guards remain',()=>{
 const task=dueTask();delete task.workerSubmissions;
 assert.deepEqual(dueReminderRecipients(task,[tech,other],reminderTime).map(p=>p.id),['a','b']);
 task.items=task.items.filter(item=>item.responsibleId!=='a');
 assert.equal(isCurrentDueReminder(task,reminder(task),tech,reminderTime),true);
 const noTechRoles=['advisor','manager','inspector','warehouse'].map(role=>({...tech,role}));
 assert.deepEqual(dueReminderRecipients(task,noTechRoles,reminderTime),[]);
 assert.deepEqual(dueReminderRecipients(task,[{...tech,role:'advisor',roles:['advisor','technician']}],reminderTime).map(p=>p.id),['a']);
 assert.deepEqual(dueReminderRecipients({...task,executionMode:'outsourced'},[tech,other],reminderTime),[]);
});
