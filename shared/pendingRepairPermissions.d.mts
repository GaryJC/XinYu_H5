import type {UserProfile} from './types';
type PendingRepairActor = Pick<UserProfile, 'role' | 'active'> & Partial<Pick<UserProfile, 'roles' | 'outsourcingRoleMember' | 'inspectorRoleMember'>>;
export function canRegisterPendingRepair(user: PendingRepairActor | null | undefined): boolean;
export function canManagePendingRepair(user: PendingRepairActor | null | undefined): boolean;
