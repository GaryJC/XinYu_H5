import { hasRole } from '../../shared/roles.mjs';
import { HttpError } from '../http/HttpError.mjs';

export const tripFileKinds = { departure: 'trip_departure_photo', return: 'trip_return_photo', signature: 'trip_signature' };
export function requireTripUser(user) {
  if (!user?.id || !user.active || !user.shopId) throw new HttpError(403, '当前员工无法使用出车申请');
}
export function requireVehicleManager(user) {
  requireTripUser(user);
  if (!hasRole(user, 'manager')) throw new HttpError(403, '仅门店管理员可管理车辆或审批');
}
export function tripText(value, label, max = 500, optional = false) {
  const text = typeof value === 'string' ? value.trim() : '';
  if ((!optional && !text) || text.length > max) throw new HttpError(400, `${label}${optional ? '' : '不能为空，且'}最多 ${max} 个字`);
  return text;
}
export function vehicleInput(input) {
  const plate = tripText(input.plate, '车牌号', 30).replace(/\s/g, '').toUpperCase();
  if (!plate) throw new HttpError(400, '车牌号不能为空');
  if (input.active !== undefined && typeof input.active !== 'boolean') throw new HttpError(400, '车辆启用状态无效');
  return { plate, brand: tripText(input.brand, '品牌', 50), model: tripText(input.model, '车型', 100), active: input.active ?? true };
}
export function assertTripAccess(trip, user) {
  requireTripUser(user);
  if (!trip || trip.shopId !== user.shopId || (trip.applicantId !== user.id && !hasRole(user, 'manager'))) throw new HttpError(404, '申请不存在或无权访问');
}
export function assertTripAction(trip, user, action) {
  assertTripAccess(trip, user);
  const approval = action === 'approve' || action === 'reject';
  if (approval) {
    requireVehicleManager(user);
    if (trip.applicantId === user.id) throw new HttpError(403, '不能审批自己的申请');
  } else if (trip.applicantId !== user.id) throw new HttpError(403, '仅申请人可操作出车、还车或取消');
  const states = { approve: ['待审批'], reject: ['待审批'], cancel: ['待审批', '待出车'], depart: ['待出车'], return: ['用车中'] };
  if (!Object.hasOwn(states, action)) throw new HttpError(400, '不支持的操作');
  if (!states[action].includes(trip.status)) throw new HttpError(409, '申请状态已变化，请刷新后重试');
}
export function assertTripUpload(trip, user, stage) {
  const action = { departure: 'depart', return: 'return' }[stage];
  if (!action) throw new HttpError(400, '附件用途无效');
  assertTripAction(trip, user, action);
}
