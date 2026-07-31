import { executeSqlServerQuery } from "../database/sqlServerPool.mjs";

export const LIST_LEGACY_DEPARTMENTS_QUERY = `
  select
    RTRIM(department.bm) as code,
    RTRIM(department.mc) as name,
    department.mrbm as is_default
  from dbo.bmxxb department
  where exists (
    select 1
    from dbo.qxwxb work_order
    where RTRIM(work_order.bm) = RTRIM(department.bm)
  )
  order by department.bm
`;

export async function listLegacyDepartments(execute = executeSqlServerQuery) {
  const result = await execute(LIST_LEGACY_DEPARTMENTS_QUERY);
  return (result.recordset || []).map((row) => ({
    code: String(row.code || "").trim(),
    name: String(row.name || "").trim(),
    isDefault: Boolean(row.is_default)
  }));
}
