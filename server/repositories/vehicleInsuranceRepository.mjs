import {randomUUID} from 'node:crypto';
import {notificationNextState} from './dispatchNotificationRepository.mjs';
export async function dueInsurance(database){
 return (await database.query(`with due as (select *,insurance_end::text as end_date,
 case when insurance_end < (now() at time zone 'Asia/Shanghai')::date then -1
 when insurance_end = (now() at time zone 'Asia/Shanghai')::date then 0
 when insurance_end <= (now() at time zone 'Asia/Shanghai')::date+1 then 1
 when insurance_end <= (now() at time zone 'Asia/Shanghai')::date+7 then 7 else 30 end as milestone
 from company_vehicles where active and insurance_end<=(now() at time zone 'Asia/Shanghai')::date+30)
 select * from due d where not exists(select 1 from vehicle_insurance_notifications n where n.vehicle_id=d.id and n.insurance_end=d.insurance_end and n.milestone=d.milestone)`)).rows;
}
export async function queueInsurance(database,car,ids){
 await database.query(`insert into vehicle_insurance_notifications(id,vehicle_id,recipient_id,insurance_end,milestone)
 select $1||u.id,$2,u.id,$3,$4 from users u where u.active and u.shop_id=$5
 and (u.role in ('manager','advisor') or u.roles && array['manager','advisor']::text[])
 and ($6::text[] is null or u.id=any($6)) on conflict(vehicle_id,insurance_end,milestone,recipient_id) do nothing`,[randomUUID(),car.id,car.end_date,car.milestone,car.shop_id,ids||null]);
}
export async function claimInsurance(database){
 return (await database.query(`with candidate as(select id,status as previous_status from vehicle_insurance_notifications where status in ('pending','accepted','unknown') and next_attempt_at<=now() and (locked_until is null or locked_until<now()) and (status='pending' or task_id is not null) order by next_attempt_at,id for update skip locked limit 1)
 update vehicle_insurance_notifications n set lease_id=$1,locked_until=now()+interval '90 seconds',status=case when c.previous_status='pending' then 'unknown' else n.status end,attempts=n.attempts+case when c.previous_status='pending' then 1 else 0 end,polls=n.polls+case when c.previous_status='pending' then 0 else 1 end from candidate c where n.id=c.id returning n.*,n.insurance_end::text as end_date,c.previous_status`,[randomUUID()])).rows[0];
}
export async function insuranceContext(database,row){return (await database.query(`select v.plate,v.active as vehicle_active,v.insurance_end::text as end_date,v.shop_id as vehicle_shop,u.* from company_vehicles v join users u on u.id=$2 where v.id=$1`,[row.vehicle_id,row.recipient_id])).rows[0];}
export async function finishInsurance(database,row,result){const {status,delay}=notificationNextState(row,result);await database.query(`update vehicle_insurance_notifications set status=$3,task_id=coalesce($4,task_id),error=$5,retryable=$6,next_attempt_at=case when $7::integer is null then null else now()+make_interval(secs=>$7) end,locked_until=null,lease_id=null where id=$1 and lease_id=$2`,[row.id,row.lease_id,status,result.taskId||null,result.error||'',!!result.retryable,delay]);}
