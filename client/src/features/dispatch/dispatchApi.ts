import { request } from '../../shared/api/httpClient';
import type { ResolveRepairWritebackRequest, RepairPhotoDeleteRequest, RepairPhotoDeleteResponse, VehiclePartsHistory, RunfengWarehouse, RunfengStockSearchResult, RepairPhotoUploadRequest, RepairTaskCounts, DispatchActionRequest, DispatchDetail, DispatchPeople, DispatchTask, TechnicianSummary } from '../../../../shared/types';
import type { DispatchFilters, PageResult } from '../../../../shared/types';
export type { DispatchFilters } from '../../../../shared/types';
function query(filters: DispatchFilters) { return new URLSearchParams(Object.entries(filters).filter(([,v])=>Boolean(v)) as [string,string][]).toString(); }
export const dispatchApi={
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
  page:(filters:DispatchFilters,page:number)=>request<PageResult<DispatchTask>>(`/api/dispatch/tasks?${query(filters)}&page=${page}&pageSize=20`),
  tasks:(filters:DispatchFilters)=>request<DispatchTask[]>(`/api/dispatch/tasks?${query(filters)}`),
  people:()=>request<DispatchPeople>('/api/dispatch/people'),
  summaries:(filters:DispatchFilters)=>request<TechnicianSummary[]>(`/api/dispatch/technicians?${query({from:filters.from,to:filters.to})}`),
  detail:(id:string)=>request<DispatchDetail>(`/api/dispatch/tasks/${encodeURIComponent(id)}`),
  action:(id:string,body:DispatchActionRequest)=>request<DispatchDetail>(`/api/dispatch/tasks/${encodeURIComponent(id)}/actions`,{method:'POST',body})
};
