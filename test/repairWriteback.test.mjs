import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDispatchAction} from '../server/domain/dispatchPolicy.mjs';
import {makeWritebackSnapshot,writebackHash,validateWritebackSnapshot} from '../server/domain/repairWriteback.mjs';
// Import the SQL repository only with the same environment used for other DB tests.
const tech={id:'t',name:'甲',role:'technician',active:true,shopId:'s'},second={...tech,id:'u',name:'乙'};
const task=()=>({orderId:'o',shopId:'s',version:1,stage:'维修中',orderStatus:'维修中',technicianIds:['t','u'],items:[{id:1,name:'保养',status:'维修中'},{id:2,name:'检查',status:'维修中'}]});
const run=(task,action,extra={})=>applyDispatchAction(task,{action,expectedVersion:task.version,requestId:'responsibility-test',...extra},tech,[tech,second]);
test('multi technician completion requires each owner and rejects unassigned people',()=>{
 const initial=task();assert.throws(()=>run(initial,'submit-order'),/尚未分配本人维修项目/);
 assert.throws(()=>run(initial,'submit-order',{repairItems:initial.items.map(i=>({id:i.id,name:i.name,responsibleId:'intruder'}))}),/尚未分配本人维修项目/);
 const scheduler={...tech,id:'advisor',role:'advisor'};
 const edited=applyDispatchAction(initial,{action:'edit-repair-items',expectedVersion:initial.version,requestId:'assign-owner-test',repairItems:initial.items.map((i,n)=>({id:i.id,name:i.name,responsibleId:n?'u':'t',responsibleName:'forged'}))},scheduler,[tech,second,scheduler]);
 assert.deepEqual(edited.items.map(i=>i.responsibleName),['甲','乙']);
 const done=run(edited,'submit-order');assert.equal(done.stage,'维修中');
 const final=applyDispatchAction(done,{action:'submit-order',expectedVersion:done.version,requestId:'second-owner-submit'},second,[tech,second]);assert.equal(final.stage,'待检验');assert.equal(done.items[1].responsibleId,'u');assert.equal(initial.items[0].responsibleId,undefined);
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
const headers=()=>[{reid:10,dh:20,wd:'',plate:'鲁B12345',department:'01',xmfy:0,xmfy0:0},{reid:11,dh:20,wd:'1',plate:'鲁B12345',department:'01',xmfy:0,xmfy0:0}];
function sqlHarness({failInsert=false,existingHash,downstream=0,headerRows=headers(),protectedCounts={},removalRows=[{position:1,name:'更换机油'}]}={}) {
 let statements=[],committed=false,rolledBack=false;
 const executeTransaction=async work=>{
  try {const result=await work(async(query,configure)=>{
   const params={};const sql=new Proxy({},{get:(_,name)=>(...args)=>({name,args})});configure?.({input:(name,_type,value)=>{params[name]=value;}},sql);statements.push({query,params});
   if(query.startsWith('select reid'))return {recordset:headerRows};
   if(query.startsWith('select payload_hash'))return {recordset:existingHash?[{payload_hash:existingHash}]:[]};
   if(query.includes('as assignments'))return {recordset:[{assignments:downstream,completions:0,payments:0,returns:0}]};
   if(query.includes('as protected_count'))return {recordset:[{protected_count:protectedCounts[params.wd]??0}]};
   if(query.startsWith('select Xh'))return {recordset:removalRows};
   if(query.startsWith('select isnull(sum'))return {recordset:[{amount:0,cost:0}]};
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
 assert.doesNotThrow(()=>assertLegacyRepairHeaders(headers(),{...snapshot,legacyReid:999}));
 assert.throws(()=>assertLegacyRepairHeaders([headers()[0],headers()[0]],snapshot),/内单缺失|重复/);
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

test('dispatch identity ignores misfilled or missing ACK reid and writes canonical receipt hashes',async()=>{
 for(const legacyReid of [7808964,0,null,undefined]) {
  const mock=sqlHarness();
  await replaceLegacyRepairItems({...snapshot,legacyReid},{executeTransaction:mock.executeTransaction,source:'test'});
  const statements=mock.state().statements;
  assert.deepEqual(statements.filter(s=>s.query.startsWith('update dbo.qxwxb')).map(s=>s.params.reid),[10,11]);
  assert.ok(statements.filter(s=>s.query.startsWith('insert into dbo.h5_repair_writeback_receipts')).every(s=>s.params.hash===writebackHash(snapshot)));
 }
});
test('canonical and legacy external receipts survive ACK correction but reject changed content',async()=>{
 for(const legacyReid of [10,11]) {
  const hash=writebackHash({...snapshot,legacyReid});
  const mock=sqlHarness({existingHash:hash});
  assert.deepEqual(await replaceLegacyRepairItems({...snapshot,legacyReid:7808964},{executeTransaction:mock.executeTransaction,source:'test'}),{duplicate:true});
  assert.ok(!mock.state().statements.some(s=>/^(delete|insert|update)/.test(s.query)));
  const changed=sqlHarness({existingHash:hash});
  await assert.rejects(()=>replaceLegacyRepairItems({...snapshot,items:[{...snapshot.items[0],name:'不同项目'}]},{executeTransaction:changed.executeTransaction,source:'test'}),/幂等键/);
 }
});


test('either document with entered project values blocks all mutations before deletion',async()=>{
 for(const wd of ['', '1']) {
  const mock=sqlHarness({protectedCounts:{[wd]:1}});
  await assert.rejects(()=>replaceLegacyRepairItems(snapshot,{executeTransaction:mock.executeTransaction,source:'test'}),/非零单价、金额、成本、工时/);
  assert.ok(mock.state().rolledBack);
  assert.ok(!mock.state().statements.some(s=>/^(delete|insert|update)/.test(s.query)));
 }
 for(const field of ['xmfy','xmfy0'])for(const value of [1,-1]) {
  const rows=headers();rows[1][field]=value;
  const mock=sqlHarness({headerRows:rows});
  await assert.rejects(()=>replaceLegacyRepairItems(snapshot,{executeTransaction:mock.executeTransaction,source:'test'}),/非零项目费用/);
  assert.ok(!mock.state().statements.some(s=>/^(delete|insert|update)/.test(s.query)));
 }
});
test('protected projects query uses per-row nonzero checks and fails closed on unreadable result',async()=>{
 const {LEGACY_PROTECTED_PROJECTS}=await import('../server/repositories/legacyRepairWritebackRepository.mjs');
 for(const field of ['dj','je','cb','gs','ywyje','uddec1','uddec2'])assert.ok(LEGACY_PROTECTED_PROJECTS.includes(`isnull(${field},0)<>0`));
 assert.match(LEGACY_PROTECTED_PROJECTS,/updlock,holdlock/);assert.doesNotMatch(LEGACY_PROTECTED_PROJECTS,/sum\(/i);
 const mock=sqlHarness({protectedCounts:{'1':'invalid'}});
 await assert.rejects(()=>replaceLegacyRepairItems(snapshot,{executeTransaction:mock.executeTransaction,source:'test'}),/无法核实/);
 assert.ok(!mock.state().statements.some(s=>/^(delete|insert|update)/.test(s.query)));
});
test('audited or settled external document blocks the whole writeback',async()=>{
 for(const change of [{approved:'1'},{settled:'2026-10-26'},{deleted:'1'}]) {
  const rows=headers();Object.assign(rows[1],change);
  const mock=sqlHarness({headerRows:rows});
  await assert.rejects(()=>replaceLegacyRepairItems(snapshot,{executeTransaction:mock.executeTransaction,source:'test'}),/删除、结算或审核/);
  assert.ok(!mock.state().statements.some(s=>/^(delete|insert|update)/.test(s.query)));
 }
});

test('explicit final deferred removal clears only mutable project rows and still enforces pricing protection',async()=>{
 const empty={...snapshot,items:[],allowEmptyRemoval:true};
 const mock=sqlHarness();await replaceLegacyRepairItems(empty,{executeTransaction:mock.executeTransaction,source:'test'});
 assert.equal(mock.state().committed,true);assert.equal(mock.state().statements.filter(s=>s.query.startsWith('delete')).length,2);
 assert.equal(mock.state().statements.filter(s=>s.query.startsWith('insert into dbo.qxwxmxb')).length,0);
 const protectedMock=sqlHarness({protectedCounts:{'':1}});
 await assert.rejects(()=>replaceLegacyRepairItems(empty,{executeTransaction:protectedMock.executeTransaction,source:'test'}),/计价数据/);
 assert.equal(protectedMock.state().statements.some(s=>s.query.startsWith('delete')),false);
});


test('deferred removal deletes only its original position without publishing unrelated work or requiring employee bindings',async()=>{
 const removal={...snapshot,operation:'remove',removeItem:{id:1,name:'更换机油',legacyPosition:1},items:[{id:2,name:'未检验项目',employeeCode:null}],allowEmptyRemoval:true};
 const mock=sqlHarness();await replaceLegacyRepairItems(removal,{executeTransaction:mock.executeTransaction,source:'test'});
 const writes=mock.state().statements;
 assert.equal(writes.filter(s=>s.query.startsWith('delete')).length,2);
 assert.ok(writes.filter(s=>s.query.startsWith('delete')).every(s=>s.query.includes('Xh=@xh')&&s.params.xh===1&&s.params.name==='更换机油'));
 assert.ok(!writes.some(s=>s.query.startsWith('insert into dbo.qxwxmxb')||s.query.startsWith('update dbo.qxwxb')));
 for(const options of [{removalRows:[{position:1,name:'其他项目'}]},{removalRows:[{position:1,name:'更换机油'},{position:1,name:'更换机油'}]},{protectedCounts:{'':1}},{headerRows:[{...headers()[0],approved:'1'}]}]) {
  const blocked=sqlHarness(options);await assert.rejects(()=>replaceLegacyRepairItems(removal,{executeTransaction:blocked.executeTransaction,source:'test'}));
  assert.ok(!blocked.state().statements.some(s=>s.query.startsWith('delete')));
 }
 const replay=sqlHarness({existingHash:writebackHash(removal)});
 assert.deepEqual(await replaceLegacyRepairItems(removal,{executeTransaction:replay.executeTransaction,source:'test'}),{duplicate:true});
});

test('consecutive cancellation snapshots retain legacy positions and ignore live uninspected items',async()=>{
 const {enqueueRepairRemoval}=await import('../server/repositories/repairWritebackRepository.mjs');
 let baseline={items:[{id:1,name:'【待定】一'},{id:2,name:'【待定】二'},{id:3,name:'已通过',employeeCode:null}]};
 const client={query:async(sql,args)=>{
  if(sql.startsWith('select snapshot'))return {rows:[{snapshot:baseline}]};
  assert.ok(sql.startsWith('insert into repair_writebacks'));baseline=JSON.parse(args[2]);return {rows:[]};
 }};
 const live={orderId:'o',plate:'鲁B12345',items:[{id:4,name:'正在维修',responsibleId:'unbound'}]};
 await enqueueRepairRemoval(client,live,1,{itemId:1,name:'一'});
 assert.deepEqual(baseline.items.map(i=>[i.id,i.legacyPosition]),[[2,2],[3,3]]);
 assert.doesNotThrow(()=>validateWritebackSnapshot(baseline));
 await enqueueRepairRemoval(client,live,2,{itemId:2,name:'二'});
 assert.equal(baseline.removeItem.legacyPosition,2);assert.deepEqual(baseline.items.map(i=>i.id),[3]);
 assert.doesNotThrow(()=>validateWritebackSnapshot(baseline));
});
