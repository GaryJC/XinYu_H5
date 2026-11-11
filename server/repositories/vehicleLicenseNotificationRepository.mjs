import {notificationNextState} from './dispatchNotificationRepository.mjs';
// Disabled categories must not acquire leases or recreate a delivery fanout.
export async function claimLicenseResolution() { return undefined; }
export async function queueLicenseManagers() {}
export async function failLicenseResolution() {}
export async function claimLicenseDelivery() { return undefined; }
export async function licenseDeliveryContext(row,database) {
  return (await database.query('select e.payload,u.dingtalk_user_id,u.active,u.role,u.roles,u.shop_id from vehicle_license_exceptions e join users u on u.id=$2 where e.id=$1',[row.exception_id,row.recipient_id])).rows[0];
}
export async function finishLicenseDelivery(row,result,database) {
  const {status,delay}=notificationNextState(row,result);
  await database.query(`update vehicle_license_exception_notifications set status=$3,task_id=coalesce($4,task_id),error=$5,retryable=$6,
    delivery_user_id=coalesce($8::text,delivery_user_id),delivery_submitted_at=case when $8::text is not null then now() else delivery_submitted_at end,
    next_attempt_at=case when $7::integer is null then null else now()+make_interval(secs=>$7::integer) end,locked_until=null,lease_id=null where id=$1 and lease_id=$2`,[row.id,row.lease_id,status,result.taskId||null,result.error||'',Boolean(result.retryable),delay,result.deliveryUserId||null]);
}
