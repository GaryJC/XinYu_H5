export function customerVehicleEditEnabled(env = process.env) {
  return env.RUNFENG_CUSTOMER_VEHICLE_UPDATE_ENABLED === "true";
}
