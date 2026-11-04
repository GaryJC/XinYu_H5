import test from 'node:test';
import assert from 'node:assert/strict';
import {newPendingRepair,saveDraftPendingRepairs} from '../server/repositories/pendingRepairsRepository.mjs';
import {validateRepairItemEdits} from '../server/domain/repairItemEditing.mjs';
import {mergePendingWriteback} from '../server/domain/pendingRepairs.mjs';
import {makeWritebackSnapshot,validateWritebackSnapshot} from '../server/domain/repairWriteback.mjs';

const actor={id:'advisor',name:'顾问'};
const stored={id:'pending-id',itemId:-1,name:'检查空调',reason:'等待客户回复',state:'pending',scheduled:false,history:[]};
function database(items=[]) {
 const writes=[];
 return {writes,async query(sql,params){
  if(sql.startsWith('select pending_repairs'))return {rows:[{items,version:1}]};
  if(sql.includes('nextval'))return {rows:[{id:-2}]};
  if(sql.startsWith('update work_orders'))writes.push(JSON.parse(params[1]));
  return {rows:[]};
 }};
}

test('pending project names must fit the repair editor before they can be registered',async()=>{
 const db=database();
 const item=await newPendingRepair(db,{name:'检'.repeat(96),reason:'等待客户回复'},actor);
 assert.doesNotThrow(()=>validateRepairItemEdits({action:'edit-repair-items',repairItems:[{name:item.name}]}));
 const snapshot=makeWritebackSnapshot({orderId:'order',plate:'鲁B12345'},mergePendingWriteback([],[item]),[]);
 assert.equal(snapshot.items[0].name.length,100);
 assert.doesNotThrow(()=>validateWritebackSnapshot(snapshot));
 for(const length of [97,100,101,200])await assert.rejects(()=>newPendingRepair(db,{name:'检'.repeat(length),reason:'等待客户回复'},actor),e=>e.status===400);
 await assert.rejects(()=>saveDraftPendingRepairs(database([stored]),{id:'order',pendingRepairs:[{...stored,name:'检'.repeat(101)}]},actor,1),e=>e.status===400);
});

test('duplicate pending IDs cannot persist two copies of the same project',async()=>{
 const db=database([stored]);
 await assert.rejects(()=>saveDraftPendingRepairs(db,{id:'order',pendingRepairs:[stored,{...stored,name:'不同名称'}]},actor,1),e=>e.status===400);
 assert.equal(db.writes.length,0);
});

test('malformed pending rows are rejected as input errors without writes',async()=>{
 for(const row of [null,[],false,'project']) {
  const db=database();
  await assert.rejects(()=>saveDraftPendingRepairs(db,{id:'order',pendingRepairs:[row]},actor,1),e=>e.status===400);
  assert.equal(db.writes.length,0);
 }
});

test('same-name projects with distinct IDs preserve separate confirmation histories',async()=>{
 const other={...stored,id:'another-id',itemId:-2,history:[{action:'登记待确认',actor:'另一顾问'}]};
 const db=database([stored,other]);
 await saveDraftPendingRepairs(db,{id:'order',pendingRepairs:[stored,other]},actor,1);
 assert.deepEqual(db.writes[0],[stored,other]);
});
