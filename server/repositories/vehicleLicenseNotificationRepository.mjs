import {randomUUID} from 'node:crypto';
import {notificationNextState} from './dispatchNotificationRepository.mjs';
export async function claimLicenseResolution(database) {
  const lease=randomUUID();
  return (await database.query(`with candidate as(select id from vehicle_license_exceptions where status='pending' and next_attempt_at<=now() and (locked_until is null or locked_until<now()) order by reported_at,id for update skip locked limit 1)
    update vehicle_license_exceptions e set lease_id=$1,locked_until=now()+interval '5 minutes',attempts=attempts+1 from candidate c where e.id=c.id returning e.*`,[lease])).rows[0];
}
export async function queueLicenseManagers(job,ids,runTransaction) {
  return runTransaction(async client=>{
    const {rows:current}=await client.query('select lease_id from vehicle_license_exceptions where id=$1 for update',[job.id]);
    if(current[0]?.lease_id!==job.lease_id)return;
    const {rows:managers}=await client.query("select id from users where active and (role='manager' or 'manager'=any(roles)) and shop_id=$1",[job.payload.shopId]);
    const targets=managers.filter(p=>!ids||ids.includes(p.id));
    if(!targets.length)throw new Error('本店暂无有效门店管理员，无法发送备案通知');
    for(const p of targets)await client.query('insert into vehicle_license_exception_notifications(id,exception_id,recipient_id) values($1,$2,$3) on conflict(exception_id,recipient_id) do nothing',[randomUUID(),job.id,p.id]);
    await client.query("update vehicle_license_exceptions set status='queued',error='',locked_until=null,lease_id=null where id=$1",[job.id]);
  });
}
export async function failLicenseResolution(job,error,database) {
  await database.query("update vehicle_license_exceptions set status=case when attempts<5 then 'pending' else 'failed' end,error=$3,next_attempt_at=now()+interval '1 minute',locked_until=null,lease_id=null where id=$1 and lease_id=$2",[job.id,job.lease_id,error]);
}
export async function claimLicenseDelivery(database) {
  return (await database.query(`with candidate as(select id,status as previous_status from vehicle_license_exception_notifications where status in ('pending','accepted','unknown') and next_attempt_at<=now()
    and (locked_until is null or locked_until<now()) and (status='pending' or task_id is not null) order by created_at,id for update skip locked limit 1)
    update vehicle_license_exception_notifications n set locked_until=now()+interval '90 seconds',lease_id=$1,
      status=case when c.previous_status='pending' then 'unknown' else n.status end,
      attempts=n.attempts+case when c.previous_status='pending' then 1 else 0 end,polls=n.polls+case when c.previous_status='pending' then 0 else 1 end
    from candidate c where n.id=c.id returning n.*,c.previous_status`,[randomUUID()])).rows[0];
}
export async function licenseDeliveryContext(row,database) {
  return (await database.query('select e.payload,u.dingtalk_user_id,u.active,u.role,u.roles,u.shop_id from vehicle_license_exceptions e join users u on u.id=$2 where e.id=$1',[row.exception_id,row.recipient_id])).rows[0];
}
export async function finishLicenseDelivery(row,result,database) {
  const {status,delay}=notificationNextState(row,result);
  await database.query(`update vehicle_license_exception_notifications set status=$3,task_id=coalesce($4,task_id),error=$5,retryable=$6,
    next_attempt_at=case when $7::integer is null then null else now()+make_interval(secs=>$7::integer) end,locked_until=null,lease_id=null where id=$1 and lease_id=$2`,[row.id,row.lease_id,status,result.taskId||null,result.error||'',Boolean(result.retryable),delay]);
}
