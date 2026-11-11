import {randomUUID} from 'node:crypto';
import {pool,transaction} from '../database/pool.mjs';
import {notificationNextState} from './dispatchNotificationRepository.mjs';
const definitions={
 dispatch:{table:'dispatch_notifications',same:"n.order_id=a.order_id and n.kind=a.kind and coalesce(n.event_id::text,n.id::text)=coalesce(a.event_id::text,a.id::text) and (n.payload->>'repairRound') is not distinct from (a.payload->>'repairRound')"},
 procurement:{table:'procurement_notifications',same:"n.shop_id=a.shop_id and n.tender_id is not distinct from a.tender_id and n.report_id is not distinct from a.report_id and coalesce(nullif(n.payload->>'notificationBatchId',''),n.id::text)=coalesce(nullif(a.payload->>'notificationBatchId',''),a.id::text)"},
 'vehicle-trip':{table:'vehicle_trip_notifications',same:'n.job_id=a.job_id'}
};
const definition=source=>{if(!Object.hasOwn(definitions,source))throw Error('Unsupported batch source');return definitions[source];};
export async function claimNotificationGroup(source,database=pool){
 const {table,same}=definition(source);
 return (await database.query(`with anchor as (select * from ${table} where status='pending' and next_attempt_at<=now() and (locked_until is null or locked_until<now()) order by next_attempt_at,id limit 1),
 candidates as (select n.id from ${table} n join anchor a on ${same} where n.status='pending' and n.next_attempt_at<=now() and (n.locked_until is null or n.locked_until<now()) order by n.id limit 20 for update of n skip locked)
 update ${table} n set error='发送前校验中',attempts=n.attempts+1,lease_id=$1,locked_until=now()+interval '90 seconds',
 task_id=null,delivery_batch_id=null,delivery_user_id=null,delivery_submitted_at=null,result_queried_at=null
 from candidates c where n.id=c.id returning n.*,'pending'::text as previous_status`,[randomUUID()])).rows;
}
// No cloud request is made until all members and their actual account snapshots
// have been committed. A crash after this point is never automatically replayed.
export async function sealNotificationBatch(source,members,messageHash,runTransaction=transaction){
 const {table}=definition(source),id=randomUUID();
 const join=source==='dispatch'?'join work_orders resource on resource.id=n.order_id':source==='vehicle-trip'?'join vehicle_trip_notification_jobs job on job.id=n.job_id join vehicle_trip_requests resource on resource.id=job.trip_id':'';
 const shop=source==='procurement'?'n.shop_id':'resource.shop_id';
 const idType=source==='vehicle-trip'?'text':'uuid';
 return runTransaction(async db=>{
  const ids=members.map(m=>String(m.row.id)),leases=members.map(m=>m.row.lease_id);
  const rows=(await db.query(`select n.id::text,n.recipient_id,u.name,u.dingtalk_user_id,n.lease_id from ${table} n join users u on u.id=n.recipient_id ${join}
   where n.id=any($1::${idType}[]) and n.status='pending' and n.locked_until>now() and u.active and u.shop_id=${shop} for update of n`,[ids])).rows;
  if(rows.length!==members.length||rows.some(r=>{const i=ids.indexOf(r.id);return r.lease_id!==leases[i]||r.dingtalk_user_id!==members[i].recipient;}))throw Error('Batch lease or recipient changed');
  await db.query('insert into notification_delivery_batches(id,source,message_hash) values($1,$2,$3)',[id,source,messageHash]);
  await db.query(`insert into notification_delivery_batch_members(batch_id,notification_id,recipient_id,recipient_name,delivery_user_id)
   select $1,x.id,x.recipient_id,x.name,x.dingtalk_user_id from jsonb_to_recordset($2::jsonb) x(id text,recipient_id text,name text,dingtalk_user_id text)`,[id,JSON.stringify(rows)]);
  await db.query(`update ${table} n set status='unknown',error='发送处理中；中断后需核对平台记录',delivery_batch_id=$1,task_id=null,delivery_user_id=m.delivery_user_id,delivery_submitted_at=now(),result_queried_at=null
   from notification_delivery_batch_members m where m.batch_id=$1 and n.id=m.notification_id::${idType}`,[id]);
  return id;
 });
}
export async function finishNotificationBatch(source,id,members,result,runTransaction=transaction){
 const {table}=definition(source),idType=source==='vehicle-trip'?'text':'uuid';
 const values=members.map(({row})=>({id:String(row.id),lease:row.lease_id,...notificationNextState(row,result)}));
 await runTransaction(async db=>{
  await db.query(`update ${table} n set status=x.status,task_id=$3,error=$4,retryable=$5,next_attempt_at=case when x.delay is null then null else now()+make_interval(secs=>x.delay) end,lease_id=null,locked_until=null
   from jsonb_to_recordset($2::jsonb) x(id text,lease text,status text,delay integer) where n.id=x.id::${idType} and n.lease_id::text=x.lease and n.delivery_batch_id=$1`,[id,JSON.stringify(values),result.taskId||null,result.error||'',!!result.retryable]);
  await db.query('update notification_delivery_batches set status=$2,task_id=$3 where id=$1',[id,result.status,result.taskId||null]);
 });
}
export async function claimBatchQuery(source,row,database=pool){
 definition(source);const lease=randomUUID();
 const batch=(await database.query(`update notification_delivery_batches b set lease_id=$2,locked_until=now()+interval '90 seconds',result_queried_at=now()
  where id=$1 and source=$3 and task_id=$4 and created_at>now()-interval '24 hours'
  and (locked_until is null or locked_until<=now()) and (result_queried_at is null or result_queried_at<=now()-interval '30 seconds') returning *`,[row.delivery_batch_id,lease,source,row.task_id])).rows[0];
 return batch;
}
export async function batchQueryMembers(source,batch,database=pool){
 const {table}=definition(source);
 return (await database.query(`select n.*,m.delivery_user_id as batch_user_id from ${table} n join notification_delivery_batch_members m on m.notification_id=n.id::text and m.batch_id=n.delivery_batch_id
  where n.delivery_batch_id=$1 and n.task_id=$2 and n.status in ('accepted','unknown')`,[batch.id,batch.task_id])).rows;
}
export async function saveBatchQuery(source,batch,results,runTransaction=transaction){
 const {table}=definition(source);
 return runTransaction(async db=>{
  const held=(await db.query('select id from notification_delivery_batches where id=$1 and lease_id=$2 and task_id=$3 for update',[batch.id,batch.lease_id,batch.task_id])).rowCount;
  if(!held)return false;
  await db.query(`update ${table} n set status=x.status,error=x.error,retryable=false,next_attempt_at=null,result_queried_at=$3,polls=n.polls+1,lease_id=null,locked_until=null
   from jsonb_to_recordset($2::jsonb) x(id text,status text,error text) where n.delivery_batch_id=$1 and n.id::text=x.id and n.task_id=$4 and n.status in ('accepted','unknown')`,[batch.id,JSON.stringify(results),batch.result_queried_at,batch.task_id]);
  await db.query('update notification_delivery_batches set lease_id=null,locked_until=null where id=$1 and lease_id=$2',[batch.id,batch.lease_id]);return true;
 });
}
export async function releaseBatchQuery(batch,database=pool){await database.query('update notification_delivery_batches set lease_id=null,locked_until=null where id=$1 and lease_id=$2',[batch.id,batch.lease_id]);}
