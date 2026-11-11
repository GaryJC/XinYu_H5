import {notificationNextState} from './dispatchNotificationRepository.mjs';
// Retired notification entry points do not scan, resolve recipients or acquire leases.
export async function dueInsurance() { return []; }
export async function queueInsurance() {}
export async function claimInsurance() { return undefined; }
export async function insuranceContext(database,row){return (await database.query(`select v.plate,v.active as vehicle_active,v.insurance_end::text as end_date,v.shop_id as vehicle_shop,u.* from company_vehicles v join users u on u.id=$2 where v.id=$1`,[row.vehicle_id,row.recipient_id])).rows[0];}
export async function finishInsurance(database,row,result){const {status,delay}=notificationNextState(row,result);await database.query(`update vehicle_insurance_notifications set status=$3,task_id=coalesce($4,task_id),error=$5,retryable=$6,
    delivery_user_id=coalesce($8::text,delivery_user_id),delivery_submitted_at=case when $8::text is not null then now() else delivery_submitted_at end,next_attempt_at=case when $7::integer is null then null else now()+make_interval(secs=>$7) end,locked_until=null,lease_id=null where id=$1 and lease_id=$2`,[row.id,row.lease_id,status,result.taskId||null,result.error||'',!!result.retryable,delay,result.deliveryUserId||null]);}
