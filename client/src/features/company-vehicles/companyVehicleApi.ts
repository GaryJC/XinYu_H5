import type { CompanyVehicle, CompanyVehicleInput } from '../../../../shared/types';
import { request } from '../../shared/api/httpClient';
export const companyVehicleApi = {
  list: (all = false) => request<CompanyVehicle[]>(`/api/company-vehicles${all ? '?all=true' : ''}`),
  save: (input: CompanyVehicleInput, id?: string) => request<CompanyVehicle>(`/api/company-vehicles${id ? `/${encodeURIComponent(id)}` : ''}`, { method: id ? 'PUT' : 'POST', body: input })
};
