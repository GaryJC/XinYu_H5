import { executeSqlServerQuery, executeSqlServerTransaction } from "../database/sqlServerPool.mjs";

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

export const FIND_LEGACY_MODEL_BY_CODE_QUERY = `
  select top 1
    RTRIM(model_ref.bh) as code,
    COALESCE(NULLIF(RTRIM(model_ref.qc), ''), RTRIM(model_ref.mc)) as value,
    (select count(*) from dbo.qxclxxb vehicle where
      RTRIM(vehicle.cx) = RTRIM(model_ref.bh)
      or RTRIM(vehicle.cx) = RTRIM(model_ref.bh) + ' ' + RTRIM(model_ref.qc)
      or RTRIM(vehicle.cx) = RTRIM(model_ref.bh) + ' ' + RTRIM(model_ref.mc)
    ) as usage_count
  from dbo.cxb model_ref
  where RTRIM(model_ref.bh) = @code
`;

export const FIND_LEGACY_ORGANIZATION_BY_CODE_QUERY = `
  select top 1
    RTRIM(customer.bm) as code,
    RTRIM(customer.mc) as value,
    (select count(*) from dbo.qxclxxb vehicle where RTRIM(vehicle.ssdw) = RTRIM(customer.bm)) as usage_count
  from dbo.khxxb customer
  where RTRIM(customer.bm) = @code
`;

export const CREATE_LEGACY_MODEL_QUERY = `
  if exists (select 1 from dbo.cxb with (updlock, holdlock) where RTRIM(bh) = @code)
  begin
    select top 1
      RTRIM(bh) as code,
      COALESCE(NULLIF(RTRIM(qc), ''), RTRIM(mc)) as value,
      0 as was_created
    from dbo.cxb
    where RTRIM(bh) = @code
  end
  else
  begin
    insert into dbo.cxb (bh, mc, qc) values (@code, @name, @name)
    select @code as code, @name as value, 1 as was_created
  end
`;

export const CREATE_LEGACY_ORGANIZATION_QUERY = `
  if exists (select 1 from dbo.khxxb with (updlock, holdlock) where RTRIM(bm) = @code)
  begin
    select top 1 RTRIM(bm) as code, RTRIM(mc) as value, 0 as was_created
    from dbo.khxxb
    where RTRIM(bm) = @code
  end
  else
  begin
    insert into dbo.khxxb (bm, mc) values (@code, @name)
    select @code as code, @name as value, 1 as was_created
  end
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

export async function findLegacyReferenceByCode(kind, code, execute = executeSqlServerQuery) {
  const query = kind === "model" ? FIND_LEGACY_MODEL_BY_CODE_QUERY : FIND_LEGACY_ORGANIZATION_BY_CODE_QUERY;
  const maxLength = kind === "model" ? 10 : 50;
  const result = await execute(query, (request, sql) => {
    request.input("code", sql.VarChar(maxLength), code);
  });
  const row = result.recordset?.[0];
  return row ? {
    value: row.value || "",
    code: row.code || "",
    usageCount: Number(row.usage_count || 0)
  } : undefined;
}

export async function createLegacyVehicleReference({ kind, code, name }, runTransaction = executeSqlServerTransaction) {
  const query = kind === "model" ? CREATE_LEGACY_MODEL_QUERY : CREATE_LEGACY_ORGANIZATION_QUERY;
  const codeLength = kind === "model" ? 10 : 50;
  return runTransaction(async (execute) => {
    const result = await execute(query, (request, sql) => {
      request.input("code", sql.VarChar(codeLength), code);
      request.input("name", sql.VarChar(200), name);
    });
    const row = result.recordset?.[0];
    if (!row) throw new Error("SQL Server 新增主数据后未返回结果");
    return {
      value: row.value || "",
      code: row.code || "",
      usageCount: 0,
      created: Boolean(row.was_created)
    };
  });
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
