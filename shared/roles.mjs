// The primary role controls the landing page; authorization uses every membership.
const validRoles = ['employee', 'manager', 'advisor', 'inspector', 'warehouse', 'technician', 'outsourcing'];
export function userRoles(user) {
  if (!user) return [];
  const roles = Array.isArray(user.roles) && user.roles.length ? user.roles : [user.role];
  return [...new Set([...roles, ...(user.outsourcingRoleMember ? ['outsourcing'] : [])])]
    .filter(role => validRoles.includes(role) && (role !== 'inspector' || user.inspectorRoleMember !== false));
}
export function hasRole(user, role) { return userRoles(user).includes(role); }
export function hasAnyRole(user, roles) { return roles.some(role => hasRole(user, role)); }
