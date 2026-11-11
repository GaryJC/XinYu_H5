import { pool } from '../database/pool.mjs';
import {isDispatchNotificationSuppressed} from '../domain/notificationPolicy.mjs';
import { HttpError } from '../http/HttpError.mjs';
import { hasAnyRole, hasRole } from '../../shared/roles.mjs';
import { queryWorkNotification } from '../integrations/dingtalk/notifications.mjs';
import { tripNotificationKinds } from '../domain/vehicleTripNotifications.mjs';
import { assertEmployeeBound } from '../domain/employeeBinding.mjs';
import * as repository from '../repositories/notificationQueryRepository.mjs';

const missing = () => new HttpError(404, '通知记录不存在或无权访问');
export function assertNotificationResourceAccess(actor, source, resource) {
  if (!actor?.active || !actor.id || !actor.shopId) throw new HttpError(403, '当前员工无权查询通知');
  if (['dispatch', 'license-exception'].includes(source)) assertEmployeeBound(actor);
  if (!resource || resource.shop_id !== actor.shopId) throw missing();
  const allowed = source === 'vehicle-trip'
    ? hasRole(actor, 'manager') || resource.applicant_id === actor.id
    : hasAnyRole(actor, source === 'procurement' ? ['manager', 'warehouse'] : ['manager', 'advisor']);
  if (!allowed) throw new HttpError(403, '当前角色无权查询此通知');
}
export function notificationQueryUnavailableReason(row, now = Date.now()) {
  if (!['accepted', 'unknown'].includes(row.status)) return '仅平台已受理或结果未知的通知可查询';
  if (!row.task_id) return '缺少平台任务编号，请在钉钉后台核对';
  if (!row.delivery_user_id?.trim() || !row.delivery_submitted_at) return '旧通知未记录实际发送账号或时间，请在钉钉后台核对';
  const submittedAt = new Date(row.delivery_submitted_at).getTime();
  if (!Number.isFinite(submittedAt) || submittedAt > now) return '发送时间无效，请在钉钉后台核对';
  if (now - submittedAt >= 24 * 60 * 60 * 1000) return '已超过钉钉发送结果查询时限（24小时）';
  if (row.locked_until && new Date(row.locked_until).getTime() > now) return '通知正在处理中，请稍后再查询';
  if (row.result_queried_at && now - new Date(row.result_queried_at).getTime() < 30 * 1000) return '刚刚已查询，请30秒后再试';
  return '';
}
async function authorize(user, source, resourceId, database) {
  const actor = await repository.currentNotificationActor(user?.id, database);
  // A stale session actor must not silently change shop scope during the call.
  if (!actor?.active || actor.shopId !== user?.shopId) throw new HttpError(403, '员工状态或门店权限已变化，请重新登录');
  const resource = await repository.notificationResource(source, resourceId, database);
  assertNotificationResourceAccess(actor, source, resource);
  return resource;
}
export async function listNotificationDeliveries(user, source, resourceId, { database = pool, now = Date.now } = {}) {
  repository.notificationSource(source);
  const resource = await authorize(user, source, resourceId, database);
  const rows = await repository.listNotificationRecords(source, resource, database);
  const time = now();
  return rows.map(row => {
    const reason = notificationQueryUnavailableReason(row, time);
    return {
      id: row.id, kind: source === 'vehicle-trip' ? tripNotificationKinds[row.kind] || row.kind : row.kind,
      recipientName: row.recipient_name, status: row.status, error: row.error || '', attempts: row.attempts,
      simulated: row.task_id?.startsWith('mock-') || false,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : '', canQuery: !reason,
      canRetry: source === 'dispatch' && row.status === 'failed' && !isDispatchNotificationSuppressed(row.kind),
      ...(reason && ['accepted', 'unknown'].includes(row.status) ? { queryUnavailableReason: reason } : {})
    };
  });
}
export async function queryNotificationDelivery(user, source, id, { database = pool, query = queryWorkNotification, now = Date.now, env = process.env } = {}) {
  repository.notificationSource(source);
  const record = await repository.notificationRecord(source, id, database);
  if (!record) throw missing();
  await authorize(user, source, record.resource_id, database);
  const unavailable = notificationQueryUnavailableReason(record, now());
  if (unavailable) throw new HttpError(409, unavailable);
  const claimed = await repository.claimNotificationQuery(source, record, database);
  if (!claimed) throw new HttpError(409, '通知状态已变化或刚刚已查询，请刷新后重试');
  let saved = false;
  try {
    await authorize(user, source, record.resource_id, database);
    let result;
    try { result = await query(claimed, claimed.delivery_user_id, { env }); }
    catch { result = { status: 'unknown', error: '暂时无法查询发送结果，请稍后手动查询' }; }
    if (!['accepted', 'unknown', 'sent', 'failed'].includes(result?.status)) result = { status: 'unknown', error: '钉钉返回结果无法确认，请稍后手动查询' };
    const output = { status: result.status, error: result.error || '' };
    if (!await repository.saveNotificationQuery(source, claimed, output, database)) throw new HttpError(409, '通知状态已变化，请刷新后查看');
    saved = true;
    // A role revocation during a slow remote request must not disclose the result.
    await authorize(user, source, record.resource_id, database);
    return output;
  } catch (error) {
    if (!saved) {
      try { await repository.releaseNotificationQuery(source, claimed, database); }
      catch (cleanupError) { console.error('[notification-query-cleanup]', { code: cleanupError.code }); }
    }
    throw error;
  }
}
