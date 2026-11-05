import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {applyDispatchAction} from '../server/domain/dispatchPolicy.mjs';
import {cancelInspectionDeferred,reconcileInspectionDeferred} from '../server/domain/inspectionDeferred.mjs';
import {allWorkersHaveItems} from '../shared/repairProgress.mjs';

const a={id:'a',name:'甲',role:'technician',shopId:'shop-hq',active:true};
const b={...a,id:'b',name:'乙'},inspector={...a,id:'i',name:'检验员',role:'inspector'};
const people=[a,b,inspector];
const base=()=>({orderId:'o',shopId:'shop-hq',orderStatus:'维修中',stage:'维修中',version:1,technicianIds:['a','b'],technicianId:'a',inspectorId:'i',items:[1,2].map(id=>({id,name:`甲项目${id}`,responsibleId:'a',responsibleName:'甲',status:'待检验',startedBy:'a',finishedBy:'a'}))});
const act=(task,actor,action,extra={})=>applyDispatchAction(task,{action,expectedVersion:task.version,requestId:'settlement-followup',...extra},actor,people);

test('declining a deferred item after partial inspection does not complete an unregistered coworkers work',()=>{
 const original=base(),input={action:'inspect',expectedVersion:original.version,requestId:'settlement-inspection',deferredItemIds:[2],deferredReason:'以后再修'};
 const inspected=applyDispatchAction(original,input,inspector,people);
 const [entry]=reconcileInspectionDeferred([],original,inspected,input,inspector,'inspection-time');
 assert.equal(inspected.stage,'维修中');assert.equal(allWorkersHaveItems(inspected),false);
 const next=cancelInspectionDeferred(inspected,entry,inspector,'不再维修','cancel-time');
 assert.equal(next.stage,'维修中');assert.equal(next.completedAt,undefined);
 assert.deepEqual(next.technicianIds,['a','b']);assert.deepEqual(next.items,inspected.items);
 const registered=act(next,b,'edit-repair-items',{repairItems:[{name:'乙补登记的维修'}]});
 assert.equal(registered.items.at(-1).responsibleId,'b');
});

test('declining an unrelated deferred item cannot force the whole team into inspection while a worker has no projects',()=>{
 const task=base(),originalItem=task.items.pop();task.deferredItems=[originalItem];
 const next=cancelInspectionDeferred(task,{itemId:2,inspectionState:'pending',originalItem},inspector,'不再维修','cancel-time');
 assert.equal(next.stage,'维修中');assert.equal(allWorkersHaveItems(next),false);
 assert.doesNotThrow(()=>act(next,b,'edit-repair-items',{repairItems:[{name:'乙项目'}]}));
});

for(const retained of [true,false])test(`cancelling a scheduled deferred item preserves a previously unregistered worker (${retained?'another inspected item remains':'no current items remain'})`,()=>{
 const task=base();task.items=retained?[{...task.items[0],status:'已完工'},{...task.items[1],status:'待开工'}]:[{...task.items[1],status:'待开工'}];
 const next=cancelInspectionDeferred(task,{itemId:2,inspectionState:'scheduled'},inspector,'不再维修','cancel-time');
 assert.equal(next.stage,'维修中');assert.equal(next.completedAt,undefined);
 assert.deepEqual(next.technicianIds,retained?['a','b']:['b']);
 assert.equal(allWorkersHaveItems(next),false);
 assert.doesNotThrow(()=>act(next,b,'edit-repair-items',{repairItems:[{name:'乙项目'}]}));
});

test('cancelling the last assigned project still finishes a team with no unregistered worker',()=>{
 const task=base();task.technicianIds=['a'];task.items=[{...task.items[1],status:'待开工'}];
 const next=cancelInspectionDeferred(task,{itemId:2,inspectionState:'scheduled'},inspector,'不再维修','cancel-time');
 assert.equal(next.stage,'维修完成');assert.equal(next.completedAt,'cancel-time');assert.deepEqual(next.technicianIds,[]);
});

const adminUrl=process.env.DISPATCH_TEST_ADMIN_URL;
test('deferred cancellation keeps persisted work orders active until every assigned worker has registered work',{skip:!adminUrl,timeout:120000},async t=>{
 const url=new URL(adminUrl);assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
 const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
 const dbName=`settlement_followup_${process.pid}_${Date.now()}`,connectionsClosed=[];let pool;
 try {
  await admin.query(`create database "${dbName}"`);url.pathname=`/${dbName}`;
  Object.assign(process.env,{DATABASE_URL:url.toString(),APP_ENV:'test',DISPATCH_NOTIFICATION_MODE:'mock',RUNFENG_REPAIR_WRITEBACK_ENABLED:'false'});
  pool=(await import('../server/database/pool.mjs')).pool;
  pool.on('connect',client=>connectionsClosed.push(new Promise(resolve=>client.once('end',resolve))));
  for(const file of (await fs.readdir('supabase/migrations')).filter(file=>file.endsWith('.sql')&&file!=='202608070005_remove_obsolete_runfeng_sync_role.sql').sort())await pool.query(await fs.readFile(`supabase/migrations/${file}`,'utf8'));
  for(const person of people)await pool.query('insert into users(id,name,role,roles,shop_id,active,legacy_employee_code,legacy_employee_name,legacy_employee_department,legacy_employee_bound_at) values($1,$2,$3,array[$3],$4,true,$5,$6,\'test\',now())',[person.id,person.name,person.role,person.shopId,`T${person.id}`,person.name]);
  const {saveDispatchTask,getDispatchTask}=await import('../server/repositories/dispatchRepository.mjs');
  const {pendingRepairCommand,pendingRepairList}=await import('../server/services/pendingRepairsService.mjs');
  const {executeDispatchAction}=await import('../server/services/dispatchService.mjs');
  for(const scheduled of [false,true])await t.test(scheduled?'scheduled cancellation preserves an unregistered coworker':'pending deletion cannot advance the commercial order to settlement',async()=>{
   const id=`settlement-followup-${scheduled}`,originalItem={id:2,name:'待定项目',responsibleId:'a',responsibleName:'甲',status:'待检验',startedBy:'a',finishedBy:'a'};
   const entry={id:'deferred-entry',itemId:2,name:originalItem.name,reason:'后续处理',source:'inspection',sourceInspectorId:'i',sourceInspectorName:'检验员',state:scheduled?'approved':'pending',scheduled,inspectionState:scheduled?'scheduled':'pending',originalItem,history:[]};
   await pool.query("insert into work_orders(id,status,advisor,technician,inspector,shop_id,old_parts_handling,vehicle_plate,arrival_date,pending_repairs) values($1,'维修中','顾问','甲、乙','检验员','shop-hq','客户带走','沪ATEST','2026-11-04',$2)",[id,JSON.stringify([entry])]);
   const task={...base(),orderId:id,acceptedAt:'2026-11-04T00:00:00Z',items:[{id:1,name:'已通过项目',responsibleId:'a',responsibleName:'甲',status:'已完工',startedBy:'a',finishedBy:'a',inspectedBy:'i',inspectorName:'检验员',inspectedAt:'2026-11-04T01:00:00Z'},...(scheduled?[{...originalItem,status:'待开工'}]:[])],deferredItems:scheduled?[]:[originalItem]};
   await saveDispatchTask(pool,task);
   const pending=await pendingRepairList(inspector,id),command={action:scheduled?'cancel':'decline',id:entry.id,expectedVersion:pending.version,requestId:randomUUID(),note:'客户不再维修该项'};
   await pendingRepairCommand(inspector,id,command);
   const next=await getDispatchTask(pool,id,inspector);
   assert.equal(next.stage,'维修中');assert.equal(next.orderStatus,'维修中');assert.deepEqual(next.technicianIds,['a','b']);
   assert.equal((await pool.query('select status from work_orders where id=$1',[id])).rows[0].status,'维修中');
   assert.equal((await pool.query("select count(*)::integer as count from repair_writebacks where order_id=$1 and snapshot->>'operation'='replace'",[id])).rows[0].count,0);
   await pendingRepairCommand(inspector,id,command);
   assert.equal((await getDispatchTask(pool,id,inspector)).version,next.version);
   const added=(await executeDispatchAction(b,id,{action:'edit-repair-items',expectedVersion:next.version,requestId:randomUUID(),repairItems:[{name:'乙新增作业'}]})).task;
   assert.equal(added.items.at(-1).responsibleId,'b');assert.equal(added.orderStatus,'维修中');
  });
 } finally {
  await pool?.end();await Promise.all(connectionsClosed);
  await admin.query(`drop database if exists "${dbName}" with (force)`);await admin.end();
 }
});
