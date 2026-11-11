import type { CompanyVehicle, CompanyVehicleInput, CompanyVehicleImportRow } from '../../../../shared/types';
import { request } from '../../shared/api/httpClient';
export const companyVehicleApi = {
  importFile: (fileBase64:string,preview:boolean) => request<{rows?:CompanyVehicleImportRow[];count?:number}>('/api/company-vehicles/import',{method:'POST',body:{fileBase64,preview}}),
  list: (all = false) => request<CompanyVehicle[]>(`/api/company-vehicles${all ? '?all=true' : ''}`),
  save: (input: CompanyVehicleInput, id?: string) => request<CompanyVehicle>(`/api/company-vehicles${id ? `/${encodeURIComponent(id)}` : ''}`, { method: id ? 'PUT' : 'POST', body: input })
};
