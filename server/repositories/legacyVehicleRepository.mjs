import { executeSqlServerQuery } from "../database/sqlServerPool.mjs";

export const FIND_LEGACY_VEHICLE_QUERY = `
  select top 1
    RTRIM(vehicle.ch) as plate,
    RTRIM(vehicle.sbdm) as vin,
    RTRIM(vehicle.cx) as model
  from dbo.qxclxxb vehicle
  where
    (@plate <> '' and REPLACE(REPLACE(UPPER(RTRIM(vehicle.ch)), ' ', ''), '-', '') = @plate)
    or
    (@vin <> '' and REPLACE(REPLACE(UPPER(RTRIM(vehicle.sbdm)), ' ', ''), '-', '') = @vin)
  order by vehicle.reid desc
`;

export async function findLegacyVehicle({ plate = "", vin = "" }, execute = executeSqlServerQuery) {
  const result = await execute(FIND_LEGACY_VEHICLE_QUERY, (request, sql) => {
    request.input("plate", sql.VarChar(50), plate);
    request.input("vin", sql.VarChar(50), vin);
  });
  const row = result.recordset?.[0];
  if (!row) return null;

  return {
    plate: row.plate || "",
    vin: row.vin || "",
    model: row.model || ""
  };
}
