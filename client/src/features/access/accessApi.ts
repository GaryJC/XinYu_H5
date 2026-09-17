import type { DingTalkMappings,DingTalkRoleMapping,DingTalkDepartmentMapping,UserProfile } from '../../../../shared/types';
import { request } from '../../shared/api/httpClient';
export const accessApi={
  users:()=>request<UserProfile[]>('/api/admin/access-users'),
  mappings:()=>request<DingTalkMappings>('/api/admin/dingtalk-mappings'),
  saveRole:(body:DingTalkRoleMapping)=>request('/api/admin/dingtalk-role-mappings',{method:'PUT',body}),
  saveDepartment:(body:DingTalkDepartmentMapping)=>request('/api/admin/dingtalk-department-mappings',{method:'PUT',body})
};
