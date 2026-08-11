import { executeSqlServerQuery } from "../database/sqlServerPool.mjs";

export const FIND_LEGACY_VEHICLE_QUERY = `
  select * from (
    select top 1
      vehicle.reid as id,
      RTRIM(vehicle.ch) as plate,
      RTRIM(vehicle.sbdm) as vin,
      COALESCE(NULLIF(RTRIM(model_ref.qc), ''), NULLIF(RTRIM(model_ref.mc), ''), RTRIM(vehicle.cx)) as model,
      RTRIM(model_ref.bh) as model_code,
      RTRIM(vehicle.ssdw) as organization_code,
      RTRIM(customer.mc) as organization_name,
      1 as plate_matched,
      0 as vin_matched
    from dbo.qxclxxb vehicle
    left join dbo.cxb model_ref on
      RTRIM(vehicle.cx) = RTRIM(model_ref.bh)
      or RTRIM(vehicle.cx) = RTRIM(model_ref.bh) + ' ' + RTRIM(model_ref.qc)
      or RTRIM(vehicle.cx) = RTRIM(model_ref.bh) + ' ' + RTRIM(model_ref.mc)
    left join dbo.khxxb customer on RTRIM(customer.bm) = RTRIM(vehicle.ssdw)
    where
      @plate <> ''
      and REPLACE(REPLACE(UPPER(RTRIM(vehicle.ch)), ' ', ''), '-', '') = @plate
    order by vehicle.reid desc
  ) plate_result
  union all
  select * from (
    select top 1
      vehicle.reid as id,
      RTRIM(vehicle.ch) as plate,
      RTRIM(vehicle.sbdm) as vin,
      COALESCE(NULLIF(RTRIM(model_ref.qc), ''), NULLIF(RTRIM(model_ref.mc), ''), RTRIM(vehicle.cx)) as model,
      RTRIM(model_ref.bh) as model_code,
      RTRIM(vehicle.ssdw) as organization_code,
      RTRIM(customer.mc) as organization_name,
      0 as plate_matched,
      1 as vin_matched
    from dbo.qxclxxb vehicle
    left join dbo.cxb model_ref on
      RTRIM(vehicle.cx) = RTRIM(model_ref.bh)
      or RTRIM(vehicle.cx) = RTRIM(model_ref.bh) + ' ' + RTRIM(model_ref.qc)
      or RTRIM(vehicle.cx) = RTRIM(model_ref.bh) + ' ' + RTRIM(model_ref.mc)
    left join dbo.khxxb customer on RTRIM(customer.bm) = RTRIM(vehicle.ssdw)
    where
      @vin <> ''
      and REPLACE(REPLACE(UPPER(RTRIM(vehicle.sbdm)), ' ', ''), '-', '') = @vin
    order by vehicle.reid desc
  ) vin_result
`;

export const FIND_LEGACY_MODEL_CANDIDATES_QUERY = `
  select top 10
    RTRIM(model_ref.bh) as code,
    COALESCE(NULLIF(RTRIM(model_ref.qc), ''), RTRIM(model_ref.mc)) as value,
    count(vehicle.reid) as usage_count
  from dbo.cxb model_ref
  left join dbo.qxclxxb vehicle on
    RTRIM(vehicle.cx) = RTRIM(model_ref.bh)
    or RTRIM(vehicle.cx) = RTRIM(model_ref.bh) + ' ' + RTRIM(model_ref.qc)
    or RTRIM(vehicle.cx) = RTRIM(model_ref.bh) + ' ' + RTRIM(model_ref.mc)
  where
    @model <> ''
    and (
      UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(model_ref.bh)), ' ', ''), '　', ''), '-', ''), '_', ''), '－', '')) like @model_pattern
      or UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(model_ref.mc)), ' ', ''), '　', ''), '-', ''), '_', ''), '－', '')) like @model_pattern
      or UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(model_ref.qc)), ' ', ''), '　', ''), '-', ''), '_', ''), '－', '')) like @model_pattern
    )
  group by RTRIM(model_ref.bh), COALESCE(NULLIF(RTRIM(model_ref.qc), ''), RTRIM(model_ref.mc))
  having count(vehicle.reid) > 0
  order by count(vehicle.reid) desc, RTRIM(model_ref.bh)
`;

export const FIND_LEGACY_ORGANIZATION_CANDIDATES_QUERY = `
  select top 20
    RTRIM(customer.bm) as code,
    RTRIM(customer.mc) as value,
    count(vehicle.reid) as usage_count
  from dbo.khxxb customer
  left join dbo.qxclxxb vehicle on RTRIM(vehicle.ssdw) = RTRIM(customer.bm)
  where
    @organization <> ''
    and UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(customer.mc)), ' ', ''), '　', ''), '-', ''), '_', ''), '－', '')) like @organization_pattern
  group by RTRIM(customer.bm), RTRIM(customer.mc)
  having count(vehicle.reid) > 0
  order by count(vehicle.reid) desc, RTRIM(customer.bm)
`;

export async function findLegacyVehicle({ plate = "", vin = "" }, execute = executeSqlServerQuery) {
  const result = await execute(FIND_LEGACY_VEHICLE_QUERY, (request, sql) => {
    request.input("plate", sql.VarChar(50), plate);
    request.input("vin", sql.VarChar(50), vin);
  });
  return (result.recordset || []).map(mapVehicleRow);
}

export async function findLegacyModelCandidates(model, execute = executeSqlServerQuery) {
  const result = await execute(FIND_LEGACY_MODEL_CANDIDATES_QUERY, (request, sql) => {
    request.input("model", sql.VarChar(200), model);
    request.input("model_pattern", sql.VarChar(500), buildFuzzyLikePattern(model));
  });
  return (result.recordset || []).map((row) => ({
    value: row.value || "",
    code: row.code || "",
    usageCount: Number(row.usage_count || 0)
  })).filter((candidate) => candidate.usageCount > 0);
}

export async function findLegacyOrganizationCandidates(organization, execute = executeSqlServerQuery) {
  const result = await execute(FIND_LEGACY_ORGANIZATION_CANDIDATES_QUERY, (request, sql) => {
    request.input("organization", sql.VarChar(200), organization);
    request.input("organization_pattern", sql.VarChar(500), buildFuzzyLikePattern(organization));
  });
  return (result.recordset || [])
    .map((row) => ({
      value: row.value || "",
      code: row.code || "",
      usageCount: Number(row.usage_count || 0)
    }))
    .filter((candidate) => candidate.usageCount > 0);
}

export function buildFuzzyLikePattern(value) {
  const escapedCharacters = Array.from(value).map((character) => {
    if (character === "%") return "[%]";
    if (character === "[") return "[[]";
    if (character === "]") return "[]]";
    return character;
  });
  return `%${escapedCharacters.join("%")}%`;
}

function mapVehicleRow(row) {
  return {
    id: String(row.id ?? ""),
    plate: row.plate || "",
    vin: row.vin || "",
    model: row.model || "",
    modelLegacyCode: row.model_code || "",
    organization: row.organization_code || row.organization_name
      ? { code: row.organization_code || "", name: row.organization_name || "" }
      : undefined,
    plateMatched: Boolean(row.plate_matched),
    vinMatched: Boolean(row.vin_matched)
  };
}
