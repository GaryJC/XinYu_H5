import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDispatchAction} from '../server/domain/dispatchPolicy.mjs';
import {makeWritebackSnapshot,writebackHash,validateWritebackSnapshot} from '../server/domain/repairWriteback.mjs';
// Import the SQL repository only with the same environment used for other DB tests.
const tech={id:'t',name:'甲',role:'technician',active:true,shopId:'s'},second={...tech,id:'u',name:'乙'};
const task=()=>({orderId:'o',shopId:'s',version:1,stage:'维修中',orderStatus:'维修中',technicianIds:['t','u'],items:[{id:1,name:'保养',status:'维修中'},{id:2,name:'检查',status:'维修中'}]});
const run=(task,action,extra={})=>applyDispatchAction(task,{action,expectedVersion:task.version,requestId:'responsibility-test',...extra},tech,[tech,second]);
test('multi technician completion requires each owner and rejects unassigned people',()=>{
 const initial=task();assert.throws(()=>run(initial,'submit-order'),/指定有效负责人/);
 assert.throws(()=>run(initial,'submit-order',{repairItems:initial.items.map(i=>({id:i.id,name:i.name,responsibleId:'intruder'}))}),/指定有效负责人/);
 const edited=run(initial,'edit-repair-items',{repairItems:initial.items.map((i,n)=>({id:i.id,name:i.name,responsibleId:n?'u':'t',responsibleName:'forged'}))});
 assert.deepEqual(edited.items.map(i=>i.responsibleName),['甲','乙']);
 const done=run(edited,'submit-order');assert.equal(done.stage,'待检验');assert.equal(done.items[1].responsibleId,'u');assert.equal(initial.items[0].responsibleId,undefined);
});
test('single technician defaults ownership and inspector locks cannot change the owner',()=>{
 const t={...task(),technicianIds:['t'],technicianId:'t'};const next=run(t,'submit-order');assert.ok(next.items.every(i=>i.responsibleId==='t'));
 const working={...t,items:[{...next.items[0],status:'已完工'},t.items[1]]};
 assert.throws(()=>run(working,'edit-repair-items',{repairItems:[{id:1,name:'保养',responsibleId:'u'},{id:2,name:'检查'}]}),/不可修改/);
});
test('snapshot uses bound employee names and remains immutable after personnel edits',()=>{
 const t={...task(),items:[{id:1,name:'保养',responsibleId:'t',responsibleName:'forged'}]};
 const users=[{id:'t',legacy_employee_code:'027',legacy_employee_name:'李富强'}];
 const snap=makeWritebackSnapshot(t,t.items,users),hash=writebackHash(snap);users[0].legacy_employee_code='999';
 assert.equal(snap.items[0].employeeCode,'027');assert.equal(snap.items[0].employeeName,'李富强');assert.equal(writebackHash(snap),hash);
 assert.throws(()=>validateWritebackSnapshot({...snap,plate:'鲁B12345',items:[{name:'保养'}]}),/绑定润丰/);
});
import {replaceLegacyRepairItems,assertLegacyRepairHeaders} from '../server/repositories/legacyRepairWritebackRepository.mjs';
const snapshot={orderId:'o',eventId:'42',plate:'鲁B12345',dispatchNo:'A123',departmentCode:'01',legacyReid:10,documentNo:20,items:[{id:1,name:'更换机油',responsibleId:'t',employeeCode:'027',employeeName:'李富强'}]};
const headers=()=>[{reid:10,dh:20,wd:'',plate:'鲁B12345',department:'01',xmfy:100,xmfy0:100},{reid:11,dh:20,wd:'1',plate:'鲁B12345',department:'01',xmfy:100,xmfy0:100}];
function sqlHarness({failInsert=false,existingHash,downstream=0}={}) {
 let statements=[],committed=false,rolledBack=false;
 const executeTransaction=async work=>{
  try {const result=await work(async(query,configure)=>{
   const params={};const sql=new Proxy({},{get:(_,name)=>(...args)=>({name,args})});configure?.({input:(name,_type,value)=>{params[name]=value;}},sql);statements.push({query,params});
   if(query.startsWith('select reid'))return {recordset:headers()};
   if(query.startsWith('select payload_hash'))return {recordset:existingHash?[{payload_hash:existingHash}]:[]};
   if(query.includes('as assignments'))return {recordset:[{assignments:downstream,completions:0,payments:0,returns:0}]};
   if(query.startsWith('select isnull(sum'))return {recordset:[{amount:100,cost:10}]};
   if(failInsert&&query.startsWith('insert into dbo.qxwxmxb'))throw new Error('injected SQL failure');
   return {recordset:[],rowsAffected:[1]};
  });committed=true;return result;}catch(error){rolledBack=true;throw error;}
 };
 return {executeTransaction,state:()=>({statements,committed,rolledBack})};
}
test('direct replacement only deletes project rows and writes employee solely to internal document',async()=>{
 const mock=sqlHarness();await replaceLegacyRepairItems(snapshot,{executeTransaction:mock.executeTransaction,source:'test'});
 const {statements,committed}=mock.state();assert.equal(committed,true);
 const deletes=statements.filter(s=>s.query.startsWith('delete'));assert.equal(deletes.length,2);assert.ok(deletes.every(s=>s.query.includes("lb=N'项目'")));
 const inserts=statements.filter(s=>s.query.startsWith('insert into dbo.qxwxmxb'));assert.deepEqual(inserts.map(s=>s.params.worker),['027 李富强','']);
 assert.ok(inserts.every(s=>s.query.includes('qxwxmxb(wd,dh,lb,hh,wxr,Xh)')&&!s.query.includes('NULL')));
 assert.equal(statements.at(-1).params.event_key,'test:42:external');
});
test('receipt replay returns without deleting rows; mismatched replay is rejected',async()=>{
 const hash=writebackHash(snapshot),same=sqlHarness({existingHash:hash});
 assert.deepEqual(await replaceLegacyRepairItems(snapshot,{executeTransaction:same.executeTransaction,source:'test'}),{duplicate:true});assert.equal(same.state().statements.length,2);
 const other=sqlHarness({existingHash:'wrong'});await assert.rejects(()=>replaceLegacyRepairItems(snapshot,{executeTransaction:other.executeTransaction,source:'test'}),/幂等键/);
});
test('SQL insertion failure rolls back the transaction and no success receipt is recorded',async()=>{
 const mock=sqlHarness({failInsert:true});await assert.rejects(()=>replaceLegacyRepairItems(snapshot,{executeTransaction:mock.executeTransaction,source:'test'}),/SQL failure/);
 assert.equal(mock.state().rolledBack,true);assert.equal(mock.state().committed,false);assert.ok(!mock.state().statements.some(s=>s.query.startsWith('insert into dbo.h5_repair_writeback_receipts')));
});
test('wrong vehicle, department, identifiers, missing document or settled headers block replacement',()=>{
 for(const change of [{plate:'其他车'},{department:'02'},{dh:999},{settled:'2026.10.18'},{deleted:'1'},{approved:'1'}])assert.throws(()=>assertLegacyRepairHeaders([{...headers()[0],...change},headers()[1]],snapshot));
 assert.doesNotThrow(()=>assertLegacyRepairHeaders(headers().slice(0,1),snapshot));
 assert.throws(()=>assertLegacyRepairHeaders(headers().slice(1),snapshot),/内单缺失/);
 assert.throws(()=>assertLegacyRepairHeaders(headers(),{...snapshot,legacyReid:999}),/主记录/);
});
test('downstream business records prevent any delete',async()=>{
 const mock=sqlHarness({downstream:1});await assert.rejects(()=>replaceLegacyRepairItems(snapshot,{executeTransaction:mock.executeTransaction,source:'test'}),/已有派工明细/);assert.ok(!mock.state().statements.some(s=>s.query.startsWith('delete')));
});
test('single technician reassignment transfers unfinished ownership before acceptance',()=>{
 const advisor={id:'a',name:'顾问',role:'advisor',active:true,shopId:'s'};
 const original={...task(),items:task().items.map(i=>({...i,responsibleId:'t',responsibleName:'甲'}))};
 const next=applyDispatchAction(original,{action:'reassign',expectedVersion:1,requestId:'owner-reassignment',technicianIds:['u'],dueAt:'2026-12-01T12:00:00Z',reason:'换班'},advisor,[advisor,tech,second]);
 assert.ok(next.items.every(i=>i.responsibleId==='u'&&i.responsibleName==='乙'));assert.equal(original.items[0].responsibleId,'t');
 const accepted=applyDispatchAction(next,{action:'accept',expectedVersion:next.version,requestId:'owner-reacceptance',partsRequirement:{mode:'none'}},second,[advisor,tech,second]);
 assert.ok(accepted.items.every(i=>i.responsibleId==='u'&&i.responsibleName==='乙'));
});

test('dispatch allowlist permits only the explicitly selected test order',async()=>{
 const {writebackAllowed,writebackDispatchAllowlist}=await import('../server/domain/repairWriteback.mjs');
 const env={RUNFENG_REPAIR_WRITEBACK_ENABLED:'true',RUNFENG_REPAIR_WRITEBACK_DISPATCH_ALLOWLIST:'A67527'};
 assert.equal(writebackAllowed('A67527',env),true);assert.equal(writebackAllowed('A67526',env),false);
 assert.deepEqual(writebackDispatchAllowlist({...env,RUNFENG_REPAIR_WRITEBACK_DISPATCH_ALLOWLIST:'bad sql!'}),[]);
 let called=false;await assert.rejects(()=>replaceLegacyRepairItems(snapshot,{source:'test',allowedDispatchNos:['A67527'],executeTransaction:async()=>{called=true;}}),/白名单/);assert.equal(called,false);
});


test('guaranteed legacy field overflow is rejected before an immutable snapshot is accepted',()=>{
 assert.throws(()=>validateWritebackSnapshot({...snapshot,items:[{...snapshot.items[0],name:'a'.repeat(101)}]}),/字段长度/);
 assert.doesNotThrow(()=>validateWritebackSnapshot({...snapshot,items:[{...snapshot.items[0],name:'a'.repeat(100)}]}));
});
test('code page preflight only issues parameterized validation SQL and propagates rejections',async()=>{
 const {validateLegacyRepairStrings}=await import('../server/repositories/legacyRepairWritebackRepository.mjs');
 let query,params={};
 await validateLegacyRepairStrings(snapshot,{execute:async(text,configure)=>{query=text;configure({input:(key,type,value)=>{params[key]=value;}},{NVarChar:()=>null});}});
 assert.ok(query.includes('DATALENGTH'));assert.ok(!/insert|delete|update/i.test(query));assert.equal(params.v0,'更换机油');assert.equal(params.v1,'027 李富强');
 await assert.rejects(()=>validateLegacyRepairStrings(snapshot,{execute:async()=>{throw new Error('不支持字符');}}),/不支持字符/);
});
