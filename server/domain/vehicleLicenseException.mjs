import {HttpError} from '../http/HttpError.mjs';
export const normalizeLicenseIdentifier=value=>String(value||'').replace(/\s/g,'').toUpperCase();
export function isCurrentLicenseException(exception,vehicle) {
  return Boolean(exception?.id && exception.reason?.trim() && normalizeLicenseIdentifier(exception.vehiclePlate)===normalizeLicenseIdentifier(vehicle?.plate) && normalizeLicenseIdentifier(exception.vehicleVin)===normalizeLicenseIdentifier(vehicle?.vin));
}
export function validateLicenseExceptionInput(input) {
  if(!input || typeof input.reason!=='string' || !input.reason.trim() || input.reason.trim().length>1000) throw new HttpError(400,'请填写本次无法提供行驶证的说明（最多1000字）');
  if(typeof input.requestId!=='string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId)) throw new HttpError(400,'缺少有效的备案请求编号');
  return {...input,reason:input.reason.trim()};
}
