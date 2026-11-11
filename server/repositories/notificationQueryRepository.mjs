import { randomUUID } from 'node:crypto';
import { HttpError } from '../http/HttpError.mjs';

// SQL identifiers are fixed here; request input is only ever a bound value.
const sources = {
  dispatch: { table: 'dispatch_notifications', resourceColumn: 'order_id', uuid: true, kind: 'n.kind', createdAt: 'n.created_at' },
  procurement: { table: 'procurement_notifications', uuid: true, kind: "coalesce(n.payload->>'title','采购通知')", createdAt: 'n.created_at' },
  'vehicle-trip': { table: 'vehicle_trip_notifications', resourceColumn: 'job_id', kind: "coalesce(j.payload->>'notificationKind',j.action)", createdAt: 'n.created_at' },
  'license-exception': { table: 'vehicle_license_exception_notifications', resourceColumn: 'exception_id', uuid: true, kind: "'行驶证缺失备案'", createdAt: 'n.created_at' },
  'vehicle-insurance': { table: 'vehicle_insurance_notifications', resourceColumn: 'vehicle_id', kind: "'车辆保险提醒'", createdAt: 'n.delivery_submitted_at' }
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function notificationSource(source) {
  if (!Object.hasOwn(sources, source)) throw new HttpError(400, '通知类型无效');
  return sources[source];
}
export function notificationIdentifier(value, uuid = false) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || uuid && !uuidPattern.test(value)) throw new HttpError(400, '通知或业务记录编号无效');
  return value;
}
export async function currentNotificationActor(id, database) {
  const { rows } = await database.query('select id,role,roles,active,shop_id as "shopId",inspector_role_member as "inspectorRoleMember",legacy_employee_code as "legacyEmployeeCode" from users where id=$1', [id]);
  return rows[0];
}
export async function notificationResource(source, id, database) {
  notificationSource(source);
  notificationIdentifier(id, ['procurement', 'license-exception'].includes(source));
  const statements = {
    dispatch: "select id,shop_id,'order' as resource_kind from work_orders where id=$1",
    procurement: "select id,shop_id,'tender' as resource_kind from procurement_tenders where id=$1 union all select id,shop_id,'report' as resource_kind from procurement_reports where id=$1",
    'vehicle-trip': "select id,shop_id,applicant_id,'trip' as resource_kind from vehicle_trip_requests where id=$1",
    'license-exception': "select e.id,w.shop_id,'license' as resource_kind from vehicle_license_exceptions e join work_orders w on w.id=e.order_id where e.id=$1",
    'vehicle-insurance': "select id,shop_id,'insurance' as resource_kind from company_vehicles where id=$1"
  };
  const { rows } = await database.query(statements[source], [id]);
  // UUIDs are generated independently for tenders and reports; reject ambiguous
  // historical input rather than pick one resource's permissions for the other.
  return rows.length === 1 ? rows[0] : undefined;
}
export async function notificationRecord(source, id, database) {
  const definition = notificationSource(source);
  notificationIdentifier(id, definition.uuid);
  const extra = source === 'vehicle-trip' ? 'j.trip_id as resource_id' : source === 'procurement' ? 'coalesce(n.tender_id,n.report_id) as resource_id' : `n.${definition.resourceColumn} as resource_id`;
  const join = source === 'vehicle-trip' ? 'join vehicle_trip_notification_jobs j on j.id=n.job_id' : '';
  const { rows } = await database.query(`select n.*,${extra} from ${definition.table} n ${join} where n.id=$1`, [id]);
  return rows[0];
}
export async function listNotificationRecords(source, resource, database) {
  const definition = notificationSource(source);
  const join = source === 'vehicle-trip' ? 'join vehicle_trip_notification_jobs j on j.id=n.job_id' : '';
  const column = source === 'vehicle-trip' ? 'j.trip_id' : source === 'procurement' ? `n.${resource.resource_kind === 'tender' ? 'tender_id' : 'report_id'}` : `n.${definition.resourceColumn}`;
  const pendingResolution = source === 'procurement' ? ` union all
    select 'job:'||j.id::text,j.status,j.error,j.attempts,null::text,null::text,null::timestamptz,null::timestamptz,null::timestamptz,
      '通知接收人同步','通知接收人同步',j.created_at
    from procurement_notification_jobs j where j.${resource.resource_kind === 'tender' ? 'tender_id' : 'report_id'}=$1 and j.shop_id=$2 and j.status<>'ready'` : '';
  const { rows } = await database.query(`select n.id::text as id,n.status,n.error,n.attempts,n.task_id,n.delivery_user_id,n.delivery_submitted_at,n.result_queried_at,n.locked_until,
    u.name as recipient_name,${definition.kind} as kind,${definition.createdAt} as created_at
    from ${definition.table} n ${join} join users u on u.id=n.recipient_id
    where ${column}=$1${source === 'procurement' ? ' and n.shop_id=$2' : ''}${pendingResolution}
    order by created_at desc nulls last,id desc`, source === 'procurement' ? [resource.id, resource.shop_id] : [resource.id]);
  return rows;
}
export async function claimNotificationQuery(source, row, database) {
  const { table } = notificationSource(source);
  const lease = randomUUID();
  const { rows } = await database.query(`update ${table} set lease_id=$2,locked_until=now()+interval '90 seconds',result_queried_at=now(),polls=polls+1
    where id=$1 and task_id=$3 and status in ('accepted','unknown') and delivery_user_id is not null and btrim(delivery_user_id)<>''
      and delivery_submitted_at>now()-interval '24 hours' and delivery_submitted_at<=now()
      and (locked_until is null or locked_until<=now())
      and (result_queried_at is null or result_queried_at<=now()-interval '30 seconds') returning *`, [row.id, lease, row.task_id]);
  return rows[0];
}
export async function saveNotificationQuery(source, row, result, database) {
  const { table } = notificationSource(source);
  const { rowCount } = await database.query(`update ${table} set status=$4,error=$5,retryable=false,next_attempt_at=null,lease_id=null,locked_until=null
    where id=$1 and lease_id=$2 and task_id=$3`, [row.id, row.lease_id, row.task_id, result.status, result.error || '']);
  return rowCount === 1;
}
export async function releaseNotificationQuery(source, row, database) {
  const { table } = notificationSource(source);
  await database.query(`update ${table} set lease_id=null,locked_until=null where id=$1 and lease_id=$2 and task_id=$3`, [row.id, row.lease_id, row.task_id]);
}
