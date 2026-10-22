import type { UserProfile, RoleKey } from './types';
type RoleIdentity = Pick<UserProfile, 'role'> & Partial<Pick<UserProfile, 'roles' | 'outsourcingRoleMember' | 'inspectorRoleMember'>>;
export function userRoles(user: RoleIdentity | null | undefined): RoleKey[];
export function hasRole(user: RoleIdentity | null | undefined, role: string): boolean;
export function hasAnyRole(user: RoleIdentity | null | undefined, roles: readonly string[]): boolean;
