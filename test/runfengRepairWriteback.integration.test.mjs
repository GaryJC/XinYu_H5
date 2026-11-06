import test from 'node:test';
import assert from 'node:assert/strict';
import {replaceLegacyRepairItems} from '../server/repositories/legacyRepairWritebackRepository.mjs';
import {executeSqlServerQuery,executeSqlServerTransaction,closeSqlServerPool} from '../server/database/sqlServerPool.mjs';
// Opt-in: real SQL Server dialect/transaction test. Every write targets uniquely named tempdb tables.
// No real work order, receipt table, inventory or employee data is modified.
test('SQL Server 2000 temporary fixtures replace atomically and recover idempotently',{skip:process.env.RUNFENG_WRITEBACK_SQL_TEST!=='true'},async()=>{
 const suffix=`${process.pid}_${Date.now()}`;
 const names=['qxwxb','qxwxmxb','qxpgmxb','cljgb','skxcb','qxthb','h5_repair_writeback_receipts','h5_repair_round_items'];
 const tables=Object.fromEntries(names.map((name,index)=>[name,`##h5_writeback_${suffix}_${index}`]));
 const query=executeSqlServerQuery;
 function rewrite(text) {
  for(const [name,temp] of Object.entries(tables))text=text.replaceAll(`dbo.${name}`,temp);
  if(/(?:insert\s+into|update|delete\s+from)\s+dbo\./i.test(text))throw new Error('Fixture guard: attempted business table mutation');
  return text;
 }
 const snapshot={orderId:`TEST-WRITEBACK-${suffix}`,eventId:'42',plate:'测B12345',dispatchNo:'Z99999998',departmentCode:'TEST',documentNo:90123,items:[{id:1,name:'【测试】更换机油',responsibleId:'fixture-tech',employeeCode:'027',employeeName:'李富强'}]};
 const state=async()=>({headers:(await query(`select reid,wd,xmfy,xmfy0,fyhj,cbhj from ${tables.qxwxb} order by reid`)).recordset,items:(await query(`select reid,wd,lb,hh,wxr,sl,dj,je,cb,gs,ywyje,uddec1,uddec2 from ${tables.qxwxmxb} order by reid`)).recordset});
 const executeTransaction=work=>executeSqlServerTransaction(execute=>work((text,configure)=>execute(rewrite(text),configure)));
 try {
  for(const name of names.filter(n=>!n.startsWith('h5_')))await query(`select top 0 ${['qxwxb','qxwxmxb'].includes(name)?'*':'pgd'} into ${tables[name]} from dbo.${name}`);
  for(const column of ['sl','dj','je','cb','gs','ywyje','uddec1','uddec2'])await query(`alter table ${tables.qxwxmxb} add default (0) for ${column}`);
  await query(`create table ${tables.h5_repair_writeback_receipts}(event_key varchar(150) primary key,payload_hash char(64),dispatch_no varchar(20))`);
  await query(`create table ${tables.h5_repair_round_items}(item_key char(64) primary key,detail_reid int not null unique)`);
  for(const wd of ['','1']) {
   await query(`insert into ${tables.qxwxb}(wd,dh,pgd,ch,bm,xmfy,xmfy0,fyhj,cbhj) values('${wd}',90123,'Z99999998','测B12345','TEST',100,100,125,10)`);
   await query(`insert into ${tables.qxwxmxb}(wd,dh,lb,hh,wxr,je,cb,gs) values('${wd}',90123,N'项目',N'【测试】旧项目',N'旧维修人',100,10,2)`);
   await query(`insert into ${tables.qxwxmxb}(wd,dh,lb,hh,wxr,je,cb,gs) values('${wd}',90123,N'材料',N'【测试】材料',N'',20,0,0)`);
   await query(`insert into ${tables.qxwxmxb}(wd,dh,lb,hh,wxr,je,cb,gs) values('${wd}',90123,N'管理费',N'【测试】管理费',N'',5,0,0)`);
  }
  snapshot.legacyReid=Number((await query(`select min(reid) as id from ${tables.qxwxb}`)).recordset[0].id);
  const protectedBefore=await state();
  await assert.rejects(()=>replaceLegacyRepairItems(snapshot,{source:'temporary-fixture',allowedDispatchNos:null,executeTransaction}),/非零项目费用/);
  assert.deepEqual(await state(),protectedBefore);
  await query(`update ${tables.qxwxb} set xmfy=0,xmfy0=0,fyhj=25,cbhj=0`);
  await query(`update ${tables.qxwxmxb} set je=0,cb=0,gs=0 where lb=N'项目'`);
  // A value in either account must prevent even the first account from being changed.
  for(const field of ['dj','je','cb','gs','ywyje','uddec1','uddec2'])for(const value of [1,-1]) {
   await query(`update ${tables.qxwxmxb} set ${field}=${value} where wd='1' and lb=N'项目'`);
   const protectedState=await state();
   await assert.rejects(()=>replaceLegacyRepairItems(snapshot,{source:'temporary-fixture',allowedDispatchNos:null,executeTransaction}),/非零单价、金额、成本、工时/);
   assert.deepEqual(await state(),protectedState);
   await query(`update ${tables.qxwxmxb} set ${field}=0 where wd='1' and lb=N'项目'`);
  }
  // Opposite charges with a zero total are still protected.
  await query(`update ${tables.qxwxmxb} set je=10 where wd='1' and lb=N'项目'`);
  await query(`insert into ${tables.qxwxmxb}(wd,dh,lb,hh,je) values('1',90123,N'项目',N'【测试】冲销',-10)`);
  const offsetState=await state();
  await assert.rejects(()=>replaceLegacyRepairItems(snapshot,{source:'temporary-fixture',allowedDispatchNos:null,executeTransaction}),/非零单价、金额、成本、工时/);
  assert.deepEqual(await state(),offsetState);
  await query(`update ${tables.qxwxmxb} set je=0 where lb=N'项目'`);
  const before=await state();let inserted=0;
  await assert.rejects(()=>replaceLegacyRepairItems(snapshot,{source:'temporary-fixture',allowedDispatchNos:null,executeTransaction:work=>executeSqlServerTransaction(execute=>work(async(text,configure)=>{
   const safe=rewrite(text);if(text.startsWith('insert into dbo.qxwxmxb')&&++inserted===2)throw new Error('injected second document failure');return execute(safe,configure);
  }))}),/second document failure/);
  assert.deepEqual(await state(),before,'Both documents and fee totals must roll back');
  assert.equal((await query(`select count(*) as n from ${tables.h5_repair_writeback_receipts}`)).recordset[0].n,0);
  await replaceLegacyRepairItems({...snapshot,legacyReid:7808964},{source:'temporary-fixture',allowedDispatchNos:null,executeTransaction});
  const after=await state(),projects=after.items.filter(i=>i.lb.trim()==='项目');
  assert.equal(projects.length,2);assert.deepEqual(projects.map(i=>i.wxr.trim()),['027 李富强','']);assert.ok(projects.every(i=>['sl','dj','je','cb','gs','ywyje','uddec1','uddec2'].every(key=>Number(i[key])===0&&i[key]!==null)),'Omitted numeric columns must retain the database defaults');
  assert.deepEqual(after.items.filter(i=>i.lb.trim()!=='项目'),before.items.filter(i=>i.lb.trim()!=='项目'));
  assert.ok(after.headers.every(h=>Number(h.fyhj)===25&&Number(h.cbhj)===0&&Number(h.xmfy)===0&&Number(h.xmfy0)===0));
  assert.deepEqual(await replaceLegacyRepairItems(snapshot,{source:'temporary-fixture',allowedDispatchNos:null,executeTransaction}),{duplicate:true});assert.deepEqual(await state(),after);
  const name='测'.repeat(100);
  await replaceLegacyRepairItems({...snapshot,eventId:'43',items:[{...snapshot.items[0],name}]},{source:'temporary-fixture',allowedDispatchNos:null,executeTransaction});
  const fullNameState=await state();assert.ok(fullNameState.items.filter(i=>i.lb.trim()==='项目').every(i=>i.hh===name));
  await assert.rejects(()=>replaceLegacyRepairItems({...snapshot,eventId:'oversized-name',items:[{...snapshot.items[0],name:'测'.repeat(101)}]},{source:'temporary-fixture',allowedDispatchNos:null,executeTransaction}),/字段长度/);
  await assert.rejects(()=>replaceLegacyRepairItems({...snapshot,eventId:'oversized-worker',items:[{...snapshot.items[0],employeeName:'工'.repeat(60)}]},{source:'temporary-fixture',allowedDispatchNos:null,executeTransaction}),/字段长度/);
  assert.deepEqual(await state(),fullNameState,'Oversized names or employees must not truncate or delete rows');
  // Start with only the internal document; a later external document can be synchronized
  // with the same inspection snapshot without recreating the internal project's rows.
  await query(`delete from ${tables.qxwxb} where wd='1'`);
  await query(`delete from ${tables.qxwxmxb} where wd='1'`);
  const single={...snapshot,eventId:'44'};
  await replaceLegacyRepairItems(single,{source:'temporary-fixture',allowedDispatchNos:null,executeTransaction});
  const internalRows=(await state()).items.filter(i=>i.wd.trim()==='');
  await query(`insert into ${tables.qxwxb}(wd,dh,pgd,ch,bm,xmfy,xmfy0,fyhj,cbhj) values('1',90123,'Z99999998','测B12345','TEST',0,0,0,0)`);
  await replaceLegacyRepairItems(single,{source:'temporary-fixture',allowedDispatchNos:null,executeTransaction});
  const withExternal=await state();assert.deepEqual(withExternal.items.filter(i=>i.wd.trim()===''),internalRows);
  const external=withExternal.items.filter(i=>i.wd.trim()==='1');assert.equal(external.length,1);assert.equal(external[0].hh,snapshot.items[0].name);assert.equal(external[0].wxr,'');

  const round={...snapshot,operation:'write-round',eventId:'50',repairRound:1};
  await query(`update ${tables.qxwxmxb} set cb=15,gs=2 where lb=N'项目'`);
  await query(`update ${tables.qxwxb} set xmfy=30,xmfy0=30,cbhj=15`);
  const original=await state(),originalIds=new Set(original.items.map(i=>i.reid));
  const submit=payload=>replaceLegacyRepairItems(payload,{source:'temporary-fixture',allowedDispatchNos:null,executeTransaction});
  await submit(round);
  assert.deepEqual(await submit(round),{duplicate:true});
  const changed={...round,eventId:'51',items:[{...round.items[0],employeeCode:'032'}]};
  await submit(changed);
  const mixed=await state();
  assert.deepEqual(mixed.headers,original.headers);
  assert.deepEqual(mixed.items.filter(i=>originalIds.has(i.reid)),original.items);
  assert.deepEqual(mixed.items.filter(i=>!originalIds.has(i.reid)).map(i=>i.wxr.trim()),['032 李富强','']);
  await submit({...round,repairRound:2,eventId:'52'});
  assert.equal((await state()).items.length,originalIds.size+4);

  // A late blank external document must receive both internal rounds, while
  // a repeated inspection in round one contributes only its latest state.
  const round2={...round,eventId:'52',repairRound:2};
  const beforeLate=(await state()).items.filter(i=>i.wd.trim()==='');
  await query(`delete from ${tables.qxwxmxb} where wd='1'`);
  await query(`delete from ${tables.qxwxb} where wd='1'`);
  await query(`insert into ${tables.qxwxb}(wd,dh,pgd,ch,bm,xmfy,xmfy0,fyhj,cbhj) values('1',90123,'Z99999998','测B12345','TEST',0,0,0,0)`);
  const history=[round,changed].map(s=>({event_id:s.eventId,snapshot:s}));
  const replay=()=>replaceLegacyRepairItems(round2,{source:'temporary-fixture',allowedDispatchNos:null,executeTransaction,readRoundHistory:async()=>history});
  await replay();assert.deepEqual(await replay(),{duplicate:true});
  const late=(await state()).items;
  assert.equal(late.filter(i=>i.wd.trim()==='1').length,2);
  assert.deepEqual(late.filter(i=>i.wd.trim()===''),beforeLate);
  const removal={...round,eventId:'53',items:[],removedItemIds:[round.items[0].id],allowEmptyRemoval:true};
  const mapped=late.find(i=>i.wd.trim()===''&&!originalIds.has(i.reid)&&i.wxr.trim()==='032 李富强');
  await query(`update ${tables.qxwxmxb} set gs=1 where reid=${Number(mapped.reid)}`);
  await assert.rejects(()=>submit(removal),/已变动或已计价/);
  assert.equal((await state()).items.length,late.length);
  await query(`update ${tables.qxwxmxb} set gs=0 where reid=${Number(mapped.reid)}`);
  // A moved row must block both documents. If a person has already removed
  // that row, withdrawal only needs to clear its link and handle the other copy.
  await query(`update ${tables.qxwxmxb} set dh=90124 where reid=${Number(mapped.reid)}`);
  await assert.rejects(()=>submit(removal),/已变动或已计价/);
  assert.equal((await state()).items.length,late.length);
  await query(`delete from ${tables.qxwxmxb} where reid=${Number(mapped.reid)}`);
  await submit(removal);
  assert.deepEqual(await submit(removal),{duplicate:true});
  const remaining=(await state()).items;
  assert.equal(remaining.length,late.length-2);
  assert.deepEqual(remaining.filter(i=>i.wd.trim()===''&&originalIds.has(i.reid)),original.items.filter(i=>i.wd.trim()===''));
  assert.ok(!remaining.some(i=>i.reid===mapped.reid));
  assert.equal((await query(`select count(*) as n from ${tables.h5_repair_round_items} where detail_reid=${Number(mapped.reid)}`)).recordset[0].n,0);
 } finally {
  for(const table of Object.values(tables).reverse())await query(`if object_id('tempdb..${table}') is not null drop table ${table}`).catch(()=>{});
  await closeSqlServerPool();
 }
});
