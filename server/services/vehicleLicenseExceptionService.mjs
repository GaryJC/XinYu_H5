import { hasRole, hasAnyRole } from "../../shared/roles.mjs";
import {randomUUID} from 'node:crypto';
import {transaction} from '../database/pool.mjs';
import {HttpError} from '../http/HttpError.mjs';
import {lookupVehicleInCompanySystem} from '../integrations/company/vehicleLookup.mjs';
import {normalizeLicenseIdentifier,validateLicenseExceptionInput} from '../domain/vehicleLicenseException.mjs';
import {mapLicenseException,lockLicenseOrder,licenseActor,licenseRequest,orderHasLicense,latestLicenseReport,insertLicenseReport} from '../repositories/vehicleLicenseExceptionRepository.mjs';
export async function reportVehicleLicenseException(actor,orderId,raw,{runTransaction=transaction,lookup=lookupVehicleInCompanySystem}={}) {
  const input=validateLicenseExceptionInput(raw);
  return runTransaction(async client=>{
    const order=await lockLicenseOrder(client,orderId);
    if(!order)throw new HttpError(404,'委托单不存在');
    const user=await licenseActor(client,actor.id);
    if(!user?.active || !hasAnyRole(user, ['advisor','manager']) || user.role!==actor.role || user.shop_id!==order.shop_id || (!hasRole(user, 'manager')&&hasRole(user, 'advisor')&&order.advisor!==user.name))throw new HttpError(403,'无权为这张委托单备案');
    const plate=normalizeLicenseIdentifier(order.vehicle_plate),vin=normalizeLicenseIdentifier(order.vehicle_vin);
    const previous=await licenseRequest(client,orderId,input.requestId);
    if(previous) {
      if(previous.reason!==input.reason || previous.vehicle_plate!==plate || previous.vehicle_vin!==vin)throw new HttpError(409,'请求编号已用于其他备案内容');
      return mapLicenseException(previous);
    }
    if(order.status!=='草稿')throw new HttpError(409,'只能在草稿阶段办理行驶证缺失备案');
    if(!plate || !/^[A-Z0-9]{17}$/.test(vin))throw new HttpError(400,'请先填写车牌和17位 VIN，再办理备案');
    if(input.vehiclePlate!==plate || input.vehicleVin!==vin)throw new HttpError(409,'车辆信息已变化，请核对车牌与 VIN 后重新备案');
    if(await orderHasLicense(client,orderId))throw new HttpError(409,'本单已上传行驶证，无需跳过');
    if((await lookup({plate,vin})).status!=='new')throw new HttpError(409,'请先确认是公司系统中尚未登记的新车');
    const latest=await latestLicenseReport(client,orderId);
    if(latest?.reason===input.reason && latest.vehicle_plate===plate && latest.vehicle_vin===vin)return mapLicenseException(latest);
    const payload={orderId,shopId:order.shop_id,shopName:order.shop_name,plate,vin,customerName:order.customer_name,advisor:order.advisor,reportedName:user.name,reason:input.reason,arrivalDate:order.arrival_date};
    const saved=await insertLicenseReport(client,{id:randomUUID(),orderId,requestId:input.requestId,plate,vin,reason:input.reason,user,payload});
    return mapLicenseException(saved);
  });
}
