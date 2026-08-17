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

export async function getSqlServerPoolWithRetry(
  attempts = 2,
  retryDelayMs = 250,
  connect = getSqlServerPool
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await connect();
    } catch (error) {
      lastError = error;
      if (attempt < attempts && retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }
  throw lastError;
}

export async function executeSqlServerQuery(query, configureRequest) {
  const connectedPool = await getSqlServerPoolWithRetry();
  const request = connectedPool.request();
  if (configureRequest) configureRequest(request, sql);
  return request.query(query);
}

export async function executeSqlServerTransaction(work) {
  const connectedPool = await getSqlServerPoolWithRetry();
  const transaction = new sql.Transaction(connectedPool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  const execute = async (query, configureRequest) => {
    const request = new sql.Request(transaction);
    if (configureRequest) configureRequest(request, sql);
    return request.query(query);
  };

  try {
    const result = await work(execute);
    await transaction.commit();
    return result;
  } catch (error) {
    try {
      await transaction.rollback();
    } catch {
      // Preserve the original query error when the connection also fails during rollback.
    }
    throw error;
  }
}

export async function closeSqlServerPool() {
  const connectedPool = pool;
  pool = undefined;
  poolPromise = undefined;
  if (connectedPool) await connectedPool.close();
}
