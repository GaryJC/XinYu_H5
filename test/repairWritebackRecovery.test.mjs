import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:1/unused';
const {resolveFailedRepairWriteback}=await import('../server/repositories/repairWritebackRepository.mjs');
const {resolveRepairWriteback}=await import('../server/services/repairWritebackService.mjs');
const manager={id:'m',name:'管理员',role:'manager',active:true,shopId:'s'};
test('only administrators may acknowledge a failed writeback as manually registered',async()=>{
 for(const actor of [{...manager,role:'advisor'},{...manager,role:'technician'},{...manager,active:false}])await assert.rejects(()=>resolveRepairWriteback(actor,'o',{jobId:'12',reason:'已核对'}),e=>e.status===403);
});
test('manual recovery locks the exact failed job, preserves its snapshot and writes an audit',async()=>{
 const calls=[];const client={query:async(sql,values)=>{calls.push({sql,values});return {rows:sql.startsWith('select')?[{id:'12',status:'failed'}]:[]};}};
 await resolveFailedRepairWriteback(client,'o',manager,{jobId:'12',reason:' 已在润丰逐项登记 '});
 assert.match(calls[0].sql,/order_id=\$1 and id=\$2 for update/);assert.deepEqual(calls[0].values,['o','12']);
 assert.match(calls[1].sql,/status='manual'/);assert.ok(!calls[1].sql.includes('snapshot='));assert.match(calls[1].values[1],/已在润丰逐项登记/);assert.match(calls[2].sql,/audit_logs/);
});
test('recovery rejects incomplete input and any job that is no longer failed',async()=>{
 const client={query:async()=>({rows:[{id:'12',status:'pending'}]})};
 for(const input of [{jobId:'12',reason:' '},{jobId:'bad',reason:'已登记'}])await assert.rejects(()=>resolveFailedRepairWriteback(client,'o',manager,input),e=>e.status===400);
 await assert.rejects(()=>resolveFailedRepairWriteback(client,'o',manager,{jobId:'12',reason:'已登记'}),e=>e.status===409);
});

const {retryFailedRepairWriteback,processRepairWritebacks}=await import('../server/repositories/repairWritebackRepository.mjs');
const validSnapshot={orderId:'o',plate:'沪ATEST',items:[{id:1,name:'已检验项目',responsibleId:'t',employeeCode:'001',employeeName:'甲'}]};
function recoveryClient({snapshot=validSnapshot,status='failed',users=[],event,baseline}={}) {
 const calls=[];
 const job={id:'12',event_id:'24',order_id:'o',status,snapshot:structuredClone(snapshot),attempts:5};
 return {calls,job,query:async(sql,values)=>{
  calls.push({sql,values});
  if(sql.startsWith('select id,status,snapshot'))return {rows:[job]};
  if(sql.startsWith('select action,detail'))return {rows:event?[event]:[]};
  if(sql.startsWith('select snapshot'))return {rows:baseline?[{snapshot:baseline}]:[]};
  if(sql.startsWith('select u.id'))return {rows:users};
  if(sql.startsWith('select dispatch_no'))return {rows:[{dispatch_no:'B1',legacy_document_no:1,vehicle_plate:'沪ATEST'}]};
  if(sql.startsWith('update repair_writebacks set snapshot='))job.snapshot=JSON.parse(values[1]);
  if(sql.includes("set status='pending'")){job.status='pending';job.attempts=0;}
  if(sql.startsWith('select j.*'))return {rows:job.status==='pending'?[job]:[]};
  if(sql.includes("set status='synced'"))job.status='synced';
  return {rows:[]};
 }};
}
test('retry repairs missing bindings in the original failed snapshot and worker can finish it',async()=>{
 const snapshot={...validSnapshot,items:[{...validSnapshot.items[0],employeeCode:null,employeeName:null}]};
 const client=recoveryClient({snapshot,users:[{id:'t',legacy_employee_code:'002',legacy_employee_name:'乙'}]});
 await retryFailedRepairWriteback(client,'o','管理员');
 assert.equal(client.job.snapshot.items[0].employeeCode,'002');
 assert.deepEqual(client.job.snapshot.items.map(i=>[i.id,i.name]),[[1,'已检验项目']]);
 await processRepairWritebacks(fn=>fn(client),async payload=>{assert.equal(payload.items[0].employeeCode,'002');});
 assert.equal(client.job.status,'synced');
});
test('retry without a completed binding leaves the failed job untouched',async()=>{
 const client=recoveryClient({snapshot:{...validSnapshot,items:[{...validSnapshot.items[0],employeeCode:null}]}});
 await assert.rejects(()=>retryFailedRepairWriteback(client,'o','管理员'),e=>e.status===409);
 assert.equal(client.job.status,'failed');assert.ok(!client.calls.some(c=>c.sql.startsWith('update')));
});
test('valid failed and synced snapshots keep the original receipt payload even after personnel edits',async()=>{
 for(const status of ['failed','synced']) {
  const client=recoveryClient({status,users:[{id:'t',legacy_employee_code:'new',legacy_employee_name:'新姓名'}]});
  await retryFailedRepairWriteback(client,'o','管理员');
  assert.deepEqual(client.job.snapshot,validSnapshot);
  assert.ok(!client.calls.some(c=>c.sql.includes('set snapshot=')));
 }
});
test('retry migrates an invalid old cancellation into removal only, excluding uninspected work',async()=>{
 const client=recoveryClient({
  snapshot:{...validSnapshot,items:[{id:9,name:'仍在维修',responsibleId:'unbound',employeeCode:null}]},
  baseline:{...validSnapshot,items:[...validSnapshot.items,{id:2,name:'【待定】取消项目',pendingConfirmation:true}]},
  event:{action:'inspection-deferred-cancel',detail:{itemId:2,previousItems:[{id:2,name:'取消项目'},{id:9,name:'仍在维修'}]}}
 });
 await retryFailedRepairWriteback(client,'o','管理员');
 assert.equal(client.job.snapshot.operation,'remove');
 assert.deepEqual(client.job.snapshot.removeItem,{id:2,name:'【待定】取消项目',legacyPosition:2});
 assert.deepEqual(client.job.snapshot.items.map(i=>i.id),[1]);
 assert.equal(client.job.status,'pending');
});

test('retry of a cancellation-completed round repairs its full snapshot instead of reverting to removal',async()=>{
 const client=recoveryClient({snapshot:{...validSnapshot,operation:'replace',items:[{...validSnapshot.items[0],employeeCode:null}]},users:[{id:'t',legacy_employee_code:'002',legacy_employee_name:'乙'}],event:{action:'inspection-deferred-cancel',detail:{itemId:2}}});
 await retryFailedRepairWriteback(client,'o','管理员');
 assert.equal(client.job.snapshot.operation,'replace');assert.equal(client.job.snapshot.items[0].employeeCode,'002');
 assert.equal(client.job.status,'pending');
});
