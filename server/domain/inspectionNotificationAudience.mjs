import {hasRole} from '../../shared/roles.mjs';
import {canInspect} from './dispatchPolicy.mjs';

// Notification membership is narrower than the permission to perform an
// inspection: a manager must also hold the inspector role to receive notices.
export const canReceiveInspectionNotification = (task, user) =>
  user?.inspectorRoleMember !== false && hasRole(user, 'inspector') && Boolean(canInspect(task, user));
