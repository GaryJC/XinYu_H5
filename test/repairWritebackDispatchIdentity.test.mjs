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

test('a queued legacy replacement cannot erase outsourced history after upgrade',async()=>{
 let available=true,failure;
 const client={query:async(sql,args)=>{
  if(sql.startsWith('select j.*')){
   const rows=available?[{id:1,event_id:10,order_id:'o',attempts:4,snapshot:{repairRound:1,plate:'鲁B12345'}}]:[];
   available=false;return {rows};
  }
  if(sql.startsWith('select dispatch_no')){
   assert.deepEqual(args,['o',true]);
   return {rows:[{dispatch_no:'A123',legacy_document_no:20,vehicle_plate:'鲁B12345',protects_outsourced:true}]};
  }
  failure=args;return {rows:[]};
 }};
 let writes=0;
 await processRepairWritebacks(work=>work(client),async()=>{writes++;});
 assert.equal(writes,0);assert.equal(failure[1],'failed');assert.match(failure[2],/历史外包/);
});
