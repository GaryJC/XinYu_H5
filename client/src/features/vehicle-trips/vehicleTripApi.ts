import type { VehicleUsageSummary, PageResult, VehicleTrip, VehicleTripDetail, VehicleTripCreateInput, VehicleTripAction, VehicleTripActionInput, VehicleTripUploadInput, VehicleTripAttachment } from '../../../../shared/types';
import { request } from '../../shared/api/httpClient';
const root = '/api/vehicle-trip-requests';
export const vehicleTripApi = {
  page:(page:number,scope:string,signal?:AbortSignal)=>request<PageResult<VehicleTrip>>(`${root}?${new URLSearchParams({page:String(page),pageSize:'20',scope})}`,{signal}),
  list: () => request<VehicleTrip[]>(root),
  usageSummary: (month: string, signal?: AbortSignal) =>
    request<VehicleUsageSummary>(`${root}/usage?${new URLSearchParams({ month })}`, { signal }),
  reportTrips: (month: string, applicantId: string, kind: 'usage' | 'missed-returns', page: number, signal?: AbortSignal) =>
    request<PageResult<VehicleTrip>>(`${root}/${kind}?${new URLSearchParams({ month, applicantId, page: String(page), pageSize: '20' })}`, { signal }),
  detail: (id: string) => request<VehicleTripDetail>(`${root}/${encodeURIComponent(id)}`),
  create: (input: VehicleTripCreateInput) => request<VehicleTrip>(root, { method: 'POST', body: input }),
  act: (id: string, action: VehicleTripAction, input: VehicleTripActionInput) => request<VehicleTrip>(`${root}/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: input }),
  upload: (id: string, input: VehicleTripUploadInput) => request<VehicleTripAttachment>(`${root}/${encodeURIComponent(id)}/attachments`, { method: 'POST', body: input })
};
