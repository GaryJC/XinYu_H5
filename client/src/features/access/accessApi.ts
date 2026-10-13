import type { UserProfile } from '../../../../shared/types';
import { request } from '../../shared/api/httpClient';
export const accessApi = {
  users: () => request<UserProfile[]>('/api/admin/access-users')
};
