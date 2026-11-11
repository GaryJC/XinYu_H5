import {HttpError} from '../http/HttpError.mjs';
import {insuranceState} from '../../shared/vehicleInsurance.mjs';
export const insuranceFields=['originalPlate','registrationNote','condition','department','owner','payer','insurer'];
export function insuranceInput(input) {
 const date=value=>{if(!value)return null;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new HttpError(400,'保险日期无效');return value;};
 const insuranceStart=date(input.insuranceStart),insuranceEnd=date(input.insuranceEnd);
 if(Boolean(insuranceStart)!==Boolean(insuranceEnd)||insuranceStart>insuranceEnd)throw new HttpError(400,'请填写完整且有效的保险起止日期');
 const insuranceDetails={};
 for(const key of insuranceFields){const value=input.insuranceDetails?.[key]??'';if(typeof value!=='string'||value.length>500)throw new HttpError(400,'保险明细最多 500 字');insuranceDetails[key]=value.trim();}
 return {insuranceStart,insuranceEnd,insuranceDetails};
}
export function assertVehicleInsured(car){const state=insuranceState(car);if(state!=='保险有效')throw new HttpError(409,`${state}，请更新保险后再出车`);}
