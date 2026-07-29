import sql from "mssql";
import { sqlServerConfig } from "../config/sqlServerConfig.mjs";

let pool;
let poolPromise;

export async function getSqlServerPool() {
  if (pool?.connected) return pool;
  if (poolPromise) return poolPromise;

  pool = new sql.ConnectionPool(sqlServerConfig());
  poolPromise = pool.connect().catch((error) => {
    pool = undefined;
    poolPromise = undefined;
    throw error;
  });
  return poolPromise;
}

export async function executeSqlServerQuery(query, configureRequest) {
  const connectedPool = await getSqlServerPool();
  const request = connectedPool.request();
  if (configureRequest) configureRequest(request, sql);
  return request.query(query);
}

export async function closeSqlServerPool() {
  const connectedPool = pool;
  pool = undefined;
  poolPromise = undefined;
  if (connectedPool) await connectedPool.close();
}
