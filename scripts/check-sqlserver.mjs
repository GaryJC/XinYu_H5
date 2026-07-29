import { closeSqlServerPool } from "../server/database/sqlServerPool.mjs";
import { inspectSqlServer, listSqlServerUserTables } from "../server/repositories/sqlServerRepository.mjs";

try {
  const health = await inspectSqlServer();
  const includeTables = process.env.SQLSERVER_CHECK_LIST_TABLES !== "false";
  const tables = includeTables ? await listSqlServerUserTables() : undefined;
  console.log(JSON.stringify(tables ? { ...health, tables } : health, null, 2));
} catch (error) {
  console.error(`SQL Server check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await closeSqlServerPool();
}
