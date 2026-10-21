import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost/test';
const {processRepairWritebacks}=await import('../server/repositories/repairWritebackRepository.mjs');

test('worker writes with dispatch and document identity even when ACK header id is missing',async()=>{
 const queries=[],writes=[];
 let claimed=false;
 const client={query:async(sql,params)=>{
  queries.push({sql,params});
  if(sql.startsWith('select j.*')){if(claimed)return {rows:[]};claimed=true;return {rows:[{id:1,event_id:42,order_id:'o',attempts:0,snapshot:{plate:'鲁B12345',items:[{name:'补胎'}]}}]};}
  if(sql.startsWith('select dispatch_no'))return {rows:[{dispatch_no:'A123',department_code:'01',legacy_reid:null,legacy_document_no:20,vehicle_plate:'鲁B12345'}]};
  return {rows:[]};
 }};
 await processRepairWritebacks(work=>work(client),async snapshot=>writes.push(snapshot));
 assert.equal(writes.length,1);assert.equal(writes[0].dispatchNo,'A123');assert.equal(writes[0].documentNo,20);
 assert.ok(queries.some(q=>q.sql.includes("status='synced'")));
 assert.ok(!queries.some(q=>q.sql.includes('等待润丰')));
});
