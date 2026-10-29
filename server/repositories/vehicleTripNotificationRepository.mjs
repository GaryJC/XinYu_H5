import {randomUUID} from 'node:crypto';
import {notificationNextState,notificationRecipient} from './dispatchNotificationRepository.mjs';
import {VehicleTripRepository} from './vehicleTripRepository.mjs';
import {tripNotificationKinds,tripNotificationCurrent,tripNotificationRecipient,tripManagerFanout} from '../domain/vehicleTripNotifications.mjs';

export async function enqueueTripNotification(database,user,requestId,action,trip) {
  if(!Object.hasOwn(tripNotificationKinds,action))return;
  await database.query(`insert into vehicle_trip_notification_jobs(id,trip_id,actor_id,request_id,action,payload)
    values($1,$2,$3,$4,$5,$6) on conflict(actor_id,request_id) do nothing`,
    [randomUUID(),trip.id,user.id,requestId,action,JSON.stringify({...trip,actorName:user.name})]);
}
export async function claimTripResolution(database) {
  return (await database.query(`with candidate as (
    select id from vehicle_trip_notification_jobs where status='pending' and next_attempt_at<=now()
    and (locked_until is null or locked_until<now()) order by created_at,id for update skip locked limit 1
  ) update vehicle_trip_notification_jobs j set lease_id=$1,locked_until=now()+interval '5 minutes',attempts=attempts+1
    from candidate c where j.id=c.id returning j.*`,[randomUUID()])).rows[0];
}
export async function queueTripRecipients(job,managerIds,runTransaction) {
  return runTransaction(async database=>{
    const current=(await database.query('select lease_id from vehicle_trip_notification_jobs where id=$1 for update',[job.id])).rows[0];
    if(current?.lease_id!==job.lease_id)return;
    const trip=await new VehicleTripRepository(database).getTrip(job.trip_id,true);
    if(!tripNotificationCurrent(job.action,trip)) {
      await database.query("update vehicle_trip_notification_jobs set status='obsolete',locked_until=null,lease_id=null,next_attempt_at=null where id=$1",[job.id]);return;
    }
    const {rows}=await database.query('select id,shop_id as "shopId",active,role,roles from users where shop_id=$1 and active',[trip.shopId]);
    const targets=rows.filter(user=>tripNotificationRecipient(job.action,trip,user)&&(!tripManagerFanout(job.action)||!managerIds||managerIds.includes(user.id)));
    if(!targets.length)throw new Error('本店暂无有效通知接收人，请核对管理员和申请人的在职状态');
    for(const user of targets)await database.query('insert into vehicle_trip_notifications(id,job_id,recipient_id) values($1,$2,$3) on conflict(job_id,recipient_id) do nothing',[randomUUID(),job.id,user.id]);
    await database.query("update vehicle_trip_notification_jobs set status='queued',error='',locked_until=null,lease_id=null,next_attempt_at=null where id=$1",[job.id]);
  });
}
export async function failTripResolution(job,error,database) {
  await database.query(`update vehicle_trip_notification_jobs set status=case when attempts<5 then 'pending' else 'failed' end,
    error=$3,next_attempt_at=case when attempts<5 then now()+interval '1 minute' else null end,locked_until=null,lease_id=null where id=$1 and lease_id=$2`,[job.id,job.lease_id,error]);
}
export async function claimTripDelivery(database) {
  return (await database.query(`with candidate as (
    select id,status as previous_status from vehicle_trip_notifications where status in ('pending','accepted','unknown') and next_attempt_at<=now()
      and (locked_until is null or locked_until<now()) and (status='pending' or task_id is not null)
    order by created_at,id for update skip locked limit 1
  ) update vehicle_trip_notifications n set locked_until=now()+interval '90 seconds',lease_id=$1,
    status=case when c.previous_status='pending' then 'unknown' else n.status end,
    error=case when c.previous_status='pending' then '发送处理中；进程中断后须核对平台记录' else n.error end,
    attempts=n.attempts+case when c.previous_status='pending' then 1 else 0 end,
    polls=n.polls+case when c.previous_status='pending' then 0 else 1 end
    from candidate c where n.id=c.id returning n.*,c.previous_status`,[randomUUID()])).rows[0];
}
export async function tripDeliveryContext(row,database) {
  const job=(await database.query('select * from vehicle_trip_notification_jobs where id=$1',[row.job_id])).rows[0];
  if(!job)return {};
  const trip=await new VehicleTripRepository(database).getTrip(job.trip_id);
  const user=await notificationRecipient(row.recipient_id,database);
  return {job,trip,user};
}
export async function finishTripDelivery(row,result,database) {
  const {status,delay}=notificationNextState(row,result);
  await database.query(`update vehicle_trip_notifications set status=$3,task_id=coalesce($4,task_id),error=$5,retryable=$6,
    next_attempt_at=case when $7::integer is null then null else now()+make_interval(secs=>$7::integer) end,
    locked_until=null,lease_id=null where id=$1 and lease_id=$2`,
    [row.id,row.lease_id,status,result.taskId||null,result.error||'',Boolean(result.retryable),delay]);
}
