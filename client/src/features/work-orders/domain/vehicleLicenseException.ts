import type {VehicleLicenseException,WorkOrder} from '../../../../../shared/types';
export function isCurrentVehicleLicenseException(exception:VehicleLicenseException|undefined,vehicle:WorkOrder['vehicle']) {
  const normalize=(value:string)=>value.replace(/\s/g,'').toUpperCase();
  return Boolean(exception?.id&&exception.reason.trim()&&normalize(exception.vehiclePlate)===normalize(vehicle.plate)&&normalize(exception.vehicleVin)===normalize(vehicle.vin));
}
