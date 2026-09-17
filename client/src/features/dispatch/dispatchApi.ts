import { request } from '../../shared/api/httpClient';
import type { DispatchActionRequest, DispatchDetail, DispatchPeople, DispatchTask, TechnicianSummary } from '../../../../shared/types';
export type DispatchFilters = {executionMode?:string;search?:string;technicianId?:string;stage?:string;metric?:string;urgent?:string;overdue?:string;from?:string;to?:string};
function query(filters: DispatchFilters) { return new URLSearchParams(Object.entries(filters).filter(([,v])=>Boolean(v)) as [string,string][]).toString(); }
export const dispatchApi={
  tasks:(filters:DispatchFilters)=>request<DispatchTask[]>(`/api/dispatch/tasks?${query(filters)}`),
  people:()=>request<DispatchPeople>('/api/dispatch/people'),
  summaries:(filters:DispatchFilters)=>request<TechnicianSummary[]>(`/api/dispatch/technicians?${query({from:filters.from,to:filters.to})}`),
  detail:(id:string)=>request<DispatchDetail>(`/api/dispatch/tasks/${encodeURIComponent(id)}`),
  action:(id:string,body:DispatchActionRequest)=>request<DispatchDetail>(`/api/dispatch/tasks/${encodeURIComponent(id)}/actions`,{method:'POST',body})
};
