import {hasRole} from '../../shared/roles.mjs';
export const tripNotificationKinds = {
  create:'出车申请待审批',approve:'出车申请已批准',reject:'出车申请已驳回',
  cancel:'出车申请已取消',depart:'车辆已出车',return:'车辆已归还',
  'approve-return':'收车审核通过','reject-return':'收车审核退回'
};
export const tripManagerFanout = action => ['create','cancel','depart','return'].includes(action);
export function tripNotificationCurrent(action,trip,payload) {
  const states={create:['待审批'],approve:['待出车','用车中'],reject:['已驳回'],cancel:['已取消'],depart:['用车中'],return:['已还车'],'approve-return':['已还车'],'reject-return':['用车中']};
  if (!trip || !states[action]?.includes(trip.status)) return false;
  if (payload && action === 'create' && payload.status !== '待审批') return false;
  if (payload && action === 'return' && payload.status !== '已还车') return false;
  if (payload && ['return','approve-return','reject-return'].includes(action) && payload.returnRound !== trip.returnRound) return false;
  return true;
}
export function tripNotificationRecipient(action,trip,user,payload) {
  if(!user?.active||user.shopId!==trip?.shopId||!tripNotificationCurrent(action,trip,payload))return false;
  if(['approve','reject','approve-return','reject-return'].includes(action))return user.id===trip.applicantId;
  if(!hasRole(user,'manager')||user.id===trip.applicantId)return false;
  return tripManagerFanout(action)||user.id===trip.approvedBy;
}
