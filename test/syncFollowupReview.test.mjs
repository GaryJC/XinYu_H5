import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL='postgresql://unused:unused@127.0.0.1:1/unused';
process.env.APP_ENV='test';
process.env.RUNFENG_REPAIR_WRITEBACK_MODE='mock';
process.env.RUNFENG_REPAIR_WRITEBACK_ENABLED='false';
delete process.env.RUNFENG_REPAIR_WRITEBACK_MOCK_RESULT;
const {processRepairWritebackSimulations}=await import('../server/repositories/repairWritebackSimulationRepository.mjs');
const {retryFailedRepairWriteback}=await import('../server/repositories/repairWritebackRepository.mjs');

const snapshot=()=>({orderId:'o',plate:'TEST',items:[{id:1,name:'项目',responsibleId:'a',employeeCode:null,employeeName:null}]});
function harness({payload=snapshot(),bound=true,jobStatus='failed'}={}) {
 const state={job:{id:'1',event_id:'2',order_id:'o',status:jobStatus,attempts:0,snapshot:structuredClone(payload)},simulation:{status:'failed',attempts:1,error:'previous failure'},queries:[]};
 const client={query:async(sql,params=[])=>{
  state.queries.push({sql,params});
  if(sql.startsWith('select j.*,coalesce'))return {rows:state.simulation.status==='pending'?[{...state.job,mock_attempts:state.simulation.attempts,mock_snapshot:state.simulation.snapshot}]:[]};
  if(sql.startsWith('insert into repair_writeback_simulations(job_id,status,attempts')) {
   state.simulation={status:params[1],attempts:params[2],error:params[3],snapshot:JSON.parse(params[4])};return {rows:[]};
  }
  if(sql.startsWith('select j.id::text,coalesce'))return {rows:[{id:state.job.id,...state.simulation}]};
  if(sql.startsWith('select status'))return {rows:[{...state.job,mock_snapshot:state.simulation.snapshot}]};
  if(sql.startsWith('insert into repair_writeback_simulations(job_id,status')){state.simulation.status='pending';state.simulation.error='';if(params[1])state.simulation.snapshot=JSON.parse(params[1]);return {rows:[]};}
  if(sql.startsWith('select action,detail'))return {rows:[{action:'inspect',detail:{}}]};
  if(sql.startsWith('select u.id'))return {rows:bound?[{id:'a',legacy_employee_code:'001',legacy_employee_name:'维修甲'}]:[]};
  if(sql.startsWith('select dispatch_no'))throw new Error('mock recovery must not enter the real Runfeng preflight path');
  if(sql.startsWith('update repair_writebacks set snapshot=')){state.job.snapshot=JSON.parse(params[1]);return {rows:[]};}
  if(sql.startsWith('insert into audit_logs'))return {rows:[]};
  throw new Error(`unexpected query: ${sql}`);
 }};
 return {state,client};
}

test('simulation retry repairs missing employee bindings and succeeds without touching the real job status',async()=>{
 for(const jobStatus of ['pending','failed']) {
  const {state,client}=harness({jobStatus}),original=structuredClone(state.job);
  await retryFailedRepairWriteback(client,'o','管理员');
  assert.equal(state.simulation.snapshot.items[0].employeeCode,'001');
  assert.equal(state.simulation.snapshot.items[0].employeeName,'维修甲');
  assert.deepEqual(state.simulation.snapshot.items.map(item=>[item.id,item.name]),[[1,'项目']]);
  await processRepairWritebackSimulations(work=>work(client));
  assert.equal(state.simulation.status,'synced');
  assert.deepEqual(state.job,original);
  assert.ok(!state.queries.some(({sql})=>/update repair_writebacks/.test(sql)));
 }
});

test('simulation retry still rejects missing bindings before clearing the failed simulation',async()=>{
 const {state,client}=harness({bound:false}),before=structuredClone(state);
 await assert.rejects(()=>retryFailedRepairWriteback(client,'o','管理员'),error=>error.status===409&&/绑定润丰员工/.test(error.message));
 assert.deepEqual(state.job,before.job);assert.deepEqual(state.simulation,before.simulation);
 assert.ok(!state.queries.some(({sql})=>/^(update|insert)/.test(sql)));
});

test('simulation retry preserves a valid original snapshot when employee bindings have changed',async()=>{
 const payload=snapshot();Object.assign(payload.items[0],{employeeCode:'OLD',employeeName:'原姓名'});
 const {state,client}=harness({payload});
 await retryFailedRepairWriteback(client,'o','管理员');
 await processRepairWritebackSimulations(work=>work(client));
 assert.equal(state.simulation.status,'synced');assert.deepEqual(state.job.snapshot,payload);
 assert.ok(!state.queries.some(({sql})=>sql.startsWith('select u.id')||sql.startsWith('update repair_writebacks set snapshot=')));
});

test('replaying a repaired simulation retains its valid isolated snapshot rather than rebuilding the real payload',async()=>{
 const {state,client}=harness(),original=structuredClone(state.job);
 const repaired=snapshot();Object.assign(repaired.items[0],{employeeCode:'OLD',employeeName:'原模拟姓名'});
 state.simulation.snapshot=structuredClone(repaired);
 await retryFailedRepairWriteback(client,'o','管理员');
 await processRepairWritebackSimulations(work=>work(client));
 assert.equal(state.simulation.status,'synced');assert.deepEqual(state.simulation.snapshot,repaired);
 assert.deepEqual(state.job,original);assert.ok(!state.queries.some(({sql})=>sql.startsWith('select u.id')));
});

test('simulation retry refuses jobs already handled by the real workflow',async()=>{
 for(const jobStatus of ['synced','manual']) {
  const {state,client}=harness({jobStatus}),before=structuredClone(state.job);
  await assert.rejects(()=>retryFailedRepairWriteback(client,'o','管理员'),error=>error.status===409&&/真实处理结果/.test(error.message));
  assert.deepEqual(state.job,before);assert.equal(state.simulation.status,'failed');
  assert.ok(!state.queries.some(({sql})=>/^(update|insert)/.test(sql)));
 }
});
