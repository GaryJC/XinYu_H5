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
