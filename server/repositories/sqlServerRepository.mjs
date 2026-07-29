import { executeSqlServerQuery } from "../database/sqlServerPool.mjs";

export const SQL_SERVER_2000_HEALTH_QUERY = `
  select
    @@SERVERNAME as server_name,
    DB_NAME() as database_name,
    SUSER_SNAME() as login_name,
    @@VERSION as version,
    (select count(*) from dbo.sysobjects where xtype = 'U') as table_count
`;

export const SQL_SERVER_2000_TABLES_QUERY = `
  select
    RTRIM(u.name) as owner_name,
    RTRIM(o.name) as table_name
  from dbo.sysobjects o
  inner join dbo.sysusers u on u.uid = o.uid
  where o.xtype = 'U'
  order by u.name, o.name
`;

export async function inspectSqlServer(execute = executeSqlServerQuery) {
  const result = await execute(SQL_SERVER_2000_HEALTH_QUERY);
  const row = result.recordset?.[0];
  if (!row) throw new Error("SQL Server health query returned no rows");

  return {
    ok: true,
    serverName: row.server_name,
    databaseName: row.database_name,
    loginName: row.login_name,
    version: row.version,
    tableCount: Number(row.table_count)
  };
}

export async function listSqlServerUserTables(execute = executeSqlServerQuery) {
  const result = await execute(SQL_SERVER_2000_TABLES_QUERY);
  return (result.recordset || []).map((row) => ({
    owner: row.owner_name,
    name: row.table_name
  }));
}
