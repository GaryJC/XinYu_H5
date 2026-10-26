import {pool,transaction} from '../database/pool.mjs';
import {hasAnyRole} from '../../shared/roles.mjs';
import {HttpError} from '../http/HttpError.mjs';
import {findVehicleLicenseHistory,copyVehicleLicense} from '../repositories/vehicleLicenseHistoryRepository.mjs';
function authorize(actor){if(!actor?.active||!actor.shopId||!hasAnyRole(actor,['manager','advisor']))throw new HttpError(403,'无权复用行驶证');}
export async function vehicleLicenseHistory(actor,input) {
 authorize(actor);
 const row=await findVehicleLicenseHistory(pool,actor.shopId,input);
 return row?{fileId:row.id,plate:row.vehicle_plate,vin:row.matched_vin,selectedAt:new Date(row.license_selected_at||row.created_at).toISOString()}:null;
}
export async function reuseVehicleLicense(actor,input) {
 authorize(actor);
 if(!input?.fileId||!input?.vin)throw new HttpError(400,'请选择行驶证并核对 VIN');
 return transaction(async client=>{
  const row=await findVehicleLicenseHistory(client,actor.shopId,input);
  if(!row)throw new HttpError(409,'历史行驶证已变化或不属于当前车辆，请重新查询');
  return copyVehicleLicense(client,row,actor);
 });
}
export async function authorizeLicensePreview(actor,input) {
 authorize(actor);
 if(!input?.fileId||!input?.vin)throw new HttpError(400,'缺少行驶证预览参数');
 const row=await findVehicleLicenseHistory(pool,actor.shopId,input);
 if(!row)throw new HttpError(404,'行驶证不存在或无权访问');
 return row.id;
}
