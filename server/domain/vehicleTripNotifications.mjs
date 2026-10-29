import {hasRole} from '../../shared/roles.mjs';
export const tripNotificationKinds = {
  create:'出车申请待审批',approve:'出车申请已批准',reject:'出车申请已驳回',
  cancel:'出车申请已取消',depart:'车辆已出车',return:'车辆已归还'
};
export const tripManagerFanout = action => ['create','cancel'].includes(action);
export function tripNotificationCurrent(action,trip) {
  const states={create:['待审批'],approve:['待出车'],reject:['已驳回'],cancel:['已取消'],depart:['用车中'],return:['已还车']};
  return Boolean(trip&&states[action]?.includes(trip.status));
}
export function tripNotificationRecipient(action,trip,user) {
  if(!user?.active||user.shopId!==trip?.shopId||!tripNotificationCurrent(action,trip))return false;
  if(['approve','reject'].includes(action))return user.id===trip.applicantId;
  if(!hasRole(user,'manager')||user.id===trip.applicantId)return false;
  return tripManagerFanout(action)||user.id===trip.approvedBy;
}
