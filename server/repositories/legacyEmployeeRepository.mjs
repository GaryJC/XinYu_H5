import { executeSqlServerQuery } from "../database/sqlServerPool.mjs";

export const FIND_LEGACY_EMPLOYEES_QUERY = `
  select RTRIM(e.bh) as code, RTRIM(e.xm) as name,
    RTRIM(e.bm) as department_code, RTRIM(d.mc) as department_name,
    RTRIM(e.zt) as status
  from dbo.ygxxb e
  left join dbo.bmxxb d on d.bm = e.bm
  where LTRIM(RTRIM(e.xm)) = @name and e.wxg = 1 and RTRIM(e.zt) = N'在职'
  order by e.bm, e.bh
`;

export async function findLegacyEmployeesByName(name, execute = executeSqlServerQuery) {
  const result = await execute(FIND_LEGACY_EMPLOYEES_QUERY,
    (request, sql) => request.input("name", sql.NVarChar(100), name));
  return (result.recordset || []).map(row => ({
    code: String(row.code || "").trim(), name: String(row.name || "").trim(),
    departmentCode: String(row.department_code || "").trim(),
    departmentName: String(row.department_name || row.department_code || "").trim(),
    status: String(row.status || "").trim()
  }));
}
