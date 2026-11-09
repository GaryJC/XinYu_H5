import { getAuthToken, request } from '../../shared/api/httpClient';
import type {VehicleNameplateEnsureRequest} from '../../../../shared/types';
import type { ResolveRepairWritebackRequest, RepairPhotoDeleteRequest, RepairPhotoDeleteResponse, VehiclePartsHistory, RunfengWarehouse, RunfengStockSearchResult, RepairPhotoUploadRequest, RepairTaskCounts, DispatchActionRequest, DispatchDetail, DispatchPeople, DispatchTask, TechnicianSummary } from '../../../../shared/types';
import type { CompletedProjectFilters, TechnicianCompletedOrder, DispatchFilters, PageResult } from '../../../../shared/types';
export type { DispatchFilters } from '../../../../shared/types';
function query(filters: DispatchFilters) { return new URLSearchParams(Object.entries(filters).filter(([,v])=>Boolean(v)) as [string,string][]).toString(); }
const peopleReads=new Map<string,Promise<DispatchPeople>>();
function readPeople(userId:string) {
  const key=JSON.stringify([userId,getAuthToken()]);
  const existing=peopleReads.get(key);if(existing)return existing;
  const run=request<DispatchPeople>('/api/dispatch/people').finally(()=>{
    if(peopleReads.get(key)===run)peopleReads.delete(key);
  });
  peopleReads.set(key,run);return run;
}
export const dispatchApi={
  myCompletedProjects:(month:string,page:number,filters:CompletedProjectFilters={})=>request<PageResult<TechnicianCompletedOrder>>(`/api/dispatch/my-completed-projects?${new URLSearchParams(Object.entries({month,page:String(page),pageSize:'20',groupBy:'order',...filters}).filter(([,value])=>Boolean(value)) as [string,string][])}`),
  ensureNameplate:(id:string,body:VehicleNameplateEnsureRequest)=>request<{id:string|null}>(`/api/dispatch/tasks/${encodeURIComponent(id)}/nameplate/ensure`,{method:'POST',body}),
  resolveRepairWriteback:(id:string,body:ResolveRepairWritebackRequest)=>request<{ok:boolean}>(`/api/dispatch/tasks/${encodeURIComponent(id)}/repair-writeback/resolve`,{method:'POST',body}),
  retryRepairWriteback:(id:string)=>request<{ok:boolean}>(`/api/dispatch/tasks/${encodeURIComponent(id)}/repair-writeback/retry`,{method:'POST',body:{}}),
  vehiclePartsHistory:(id:string)=>request<VehiclePartsHistory>(`/api/dispatch/tasks/${encodeURIComponent(id)}/parts-history`),
  historicalPartStock:(id:string,code:string)=>request<RunfengStockSearchResult>(`/api/dispatch/tasks/${encodeURIComponent(id)}/parts-history/stock?${new URLSearchParams({code})}`),
  stockWarehouses:(id:string)=>request<{warehouses:RunfengWarehouse[]}>(`/api/dispatch/tasks/${encodeURIComponent(id)}/parts-stock/warehouses`),
  searchStock:(id:string,filters:{query:string;warehouseId?:number;inStockOnly:boolean})=>request<RunfengStockSearchResult>(`/api/dispatch/tasks/${encodeURIComponent(id)}/parts-stock?${new URLSearchParams({query:filters.query,inStockOnly:String(filters.inStockOnly),...(filters.warehouseId?{warehouseId:String(filters.warehouseId)}:{})})}`),
  myCounts:()=>request<RepairTaskCounts>('/api/dispatch/my-counts'),
  deletePhotos:(id:string,body:RepairPhotoDeleteRequest)=>request<RepairPhotoDeleteResponse>(`/api/dispatch/tasks/${encodeURIComponent(id)}/photos`,{method:'DELETE',body}),
  deletePhoto:(id:string,fileId:string)=>request<{id:string}>(`/api/dispatch/tasks/${encodeURIComponent(id)}/photos/${encodeURIComponent(fileId)}`,{method:'DELETE'}),
  uploadPhoto:(id:string,body:RepairPhotoUploadRequest)=>request<{id:string}>(`/api/dispatch/tasks/${encodeURIComponent(id)}/photos`,{method:'POST',body}),
  counts:()=>request<Record<string,number>>('/api/dispatch/tasks?counts=true'),
  page:(filters:DispatchFilters,page:number,signal?:AbortSignal)=>request<PageResult<DispatchTask>>(`/api/dispatch/tasks?${query(filters)}&page=${page}&pageSize=20`,{signal}),
  tasks:(filters:DispatchFilters)=>request<DispatchTask[]>(`/api/dispatch/tasks?${query(filters)}`),
  people:readPeople,
  summaries:(filters:DispatchFilters)=>request<TechnicianSummary[]>(`/api/dispatch/technicians?${query({from:filters.from,to:filters.to})}`),
  detail:(id:string)=>request<DispatchDetail>(`/api/dispatch/tasks/${encodeURIComponent(id)}`),
  action:(id:string,body:DispatchActionRequest)=>request<DispatchDetail>(`/api/dispatch/tasks/${encodeURIComponent(id)}/actions`,{method:'POST',body})
};
