import { executeSqlServerQuery } from "../database/sqlServerPool.mjs";

export const MAX_LEGACY_DISPATCH_NUMBER_QUERY = `
  select max(
    case
      when LEFT(UPPER(RTRIM(pgd)), 1) = @prefix
        and ISNUMERIC(SUBSTRING(RTRIM(pgd), 2, 19)) = 1
      then CONVERT(int, SUBSTRING(RTRIM(pgd), 2, 19))
      else 0
    end
  ) as max_number
  from dbo.qxwxb
`;

export async function getLatestLegacyDispatchNumber(
  prefix = "A",
  execute = executeSqlServerQuery
) {
  const normalizedPrefix = prefix.trim().toUpperCase();
  const result = await execute(MAX_LEGACY_DISPATCH_NUMBER_QUERY, (request, sql) => {
    request.input("prefix", sql.Char(1), normalizedPrefix);
  });
  const maxNumber = Number(result.recordset?.[0]?.max_number || 0);
  return {
    prefix: normalizedPrefix,
    maxNumber,
    dispatchNo: maxNumber > 0 ? `${normalizedPrefix}${maxNumber}` : ""
  };
}
