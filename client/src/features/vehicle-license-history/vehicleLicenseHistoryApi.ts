import {request,requestBlob} from '../../shared/api/httpClient';
import type {VehicleLicenseHistory,VehicleLicenseHistoryQuery,VehicleLicenseReuseResult} from '../../../../shared/types';
export const vehicleLicenseHistoryApi={
 lookup:(body:VehicleLicenseHistoryQuery)=>request<VehicleLicenseHistory|null>('/api/vehicle-licenses/history',{method:'POST',body}),
 reuse:(body:VehicleLicenseHistoryQuery)=>request<VehicleLicenseReuseResult>('/api/vehicle-licenses/reuse',{method:'POST',body}),
 preview:(fileId:string,vin:string)=>requestBlob(`/api/vehicle-licenses/preview?${new URLSearchParams({fileId,vin})}`)
};
