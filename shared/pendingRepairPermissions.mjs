import {hasAnyRole} from './roles.mjs';

export function canRegisterPendingRepair(user) {
 return Boolean(user?.active)&&hasAnyRole(user,['manager','advisor','inspector']);
}
export function canManagePendingRepair(user) {
 return Boolean(user?.active)&&hasAnyRole(user,['manager','advisor']);
}
