import type { PageResult, VehicleTrip, VehicleTripDetail, VehicleTripCreateInput, VehicleTripAction, VehicleTripActionInput, VehicleTripUploadInput, VehicleTripAttachment } from '../../../../shared/types';
import { request } from '../../shared/api/httpClient';
const root = '/api/vehicle-trip-requests';
export const vehicleTripApi = {
  page:(page:number,scope:string)=>request<PageResult<VehicleTrip>>(`${root}?${new URLSearchParams({page:String(page),pageSize:'20',scope})}`),
  list: () => request<VehicleTrip[]>(root),
  detail: (id: string) => request<VehicleTripDetail>(`${root}/${encodeURIComponent(id)}`),
  create: (input: VehicleTripCreateInput) => request<VehicleTrip>(root, { method: 'POST', body: input }),
  act: (id: string, action: VehicleTripAction, input: VehicleTripActionInput) => request<VehicleTrip>(`${root}/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: input }),
  upload: (id: string, input: VehicleTripUploadInput) => request<VehicleTripAttachment>(`${root}/${encodeURIComponent(id)}/attachments`, { method: 'POST', body: input })
};
