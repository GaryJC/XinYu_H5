import {procurementNotificationRole} from '../domain/procurementNotificationAudience.mjs';
import { randomUUID } from 'node:crypto';
import { pool,transaction } from '../database/pool.mjs';
import { notificationNextState } from './dispatchNotificationRepository.mjs';
export async function claimResolution(db=pool) {
  return (await db.query(`with c as (select id from procurement_notification_jobs where status='pending' and next_attempt_at<=now() and (locked_until is null or locked_until<now()) order by created_at for update skip locked limit 1)
    update procurement_notification_jobs j set attempts=attempts+1,lease_id=$1,locked_until=now()+interval '5 minutes' from c where c.id=j.id returning j.*`,[randomUUID()])).rows[0];
}
export async function resolveRecipients(job,ids,runTransaction=transaction) {
  await runTransaction(async db=>{
    const current=(await db.query('select * from procurement_notification_jobs where id=$1 for update',[job.id])).rows[0];if(current.lease_id!==job.lease_id)return;
    const {rows:users}=await db.query("select id from users where shop_id=$1 and active and (role=$2 or $2=any(roles))",[job.shop_id,procurementNotificationRole(job.payload)]);
    const recipients=users.filter(u=>!ids||ids.includes(u.id));if(!recipients.length)throw new Error('暂无本次通知所需岗位的接收人，请检查钉钉角色及通讯录授权');
    for(const user of recipients)await db.query('insert into procurement_notifications(id,shop_id,tender_id,report_id,recipient_id,payload) values($1,$2,$3,$4,$5,$6)',[randomUUID(),job.shop_id,job.tender_id,job.report_id,user.id,JSON.stringify({...job.payload,notificationBatchId:job.id})]);
    await db.query("update procurement_notification_jobs set status='ready',lease_id=null,locked_until=null,error='' where id=$1",[job.id]);
  });
}
export async function failResolution(job,error,db=pool) {await db.query("update procurement_notification_jobs set status=case when attempts<5 then 'pending' else 'failed' end,error=$3,lease_id=null,locked_until=null,next_attempt_at=now()+interval '1 minute' where id=$1 and lease_id=$2",[job.id,job.lease_id,error]);}
export async function claimDelivery(db=pool) {
  return (await db.query(`with c as (select id,status as previous_status from procurement_notifications where status in ('pending','accepted','unknown') and next_attempt_at<=now() and (locked_until is null or locked_until<now()) and (status='pending' or task_id is not null) order by created_at for update skip locked limit 1)
    update procurement_notifications n set lease_id=$1,locked_until=now()+interval '90 seconds',status=case when c.previous_status='pending' then 'unknown' else n.status end,
      error=case when c.previous_status='pending' then '发送处理中；中断后需核对平台记录' else n.error end,attempts=attempts+case when c.previous_status='pending' then 1 else 0 end,
      polls=polls+case when c.previous_status='pending' then 0 else 1 end from c where n.id=c.id returning n.*,c.previous_status`,[randomUUID()])).rows[0];
}
export async function finishDelivery(row,result,db=pool) {
  const {status,delay}=notificationNextState(row,result);
  await db.query(`update procurement_notifications set status=$3,task_id=coalesce($4,task_id),error=$5,retryable=$6,next_attempt_at=case when $7::integer is null then null else now()+make_interval(secs=>$7::integer) end,lease_id=null,locked_until=null,updated_at=now() where id=$1 and lease_id=$2`,[row.id,row.lease_id,status,result.taskId||null,result.error||'',!!result.retryable,delay]);
}
export async function cleanupPortal(db=pool) {
  await db.query('delete from procurement_access_attempts where expires_at<now()');
  await db.query('delete from procurement_sessions where expires_at<now()');
}
