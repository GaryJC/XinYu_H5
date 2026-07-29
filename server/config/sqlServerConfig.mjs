const supportedTdsVersions = new Set(["7_1"]);

export function hasSqlServerConfig(env = process.env) {
  return ["SQLSERVER_HOST", "SQLSERVER_DATABASE", "SQLSERVER_USER", "SQLSERVER_PASSWORD"].every(
    (name) => Boolean(env[name]?.trim())
  );
}

export function sqlServerConfig(env = process.env) {
  const port = parsePort(env.SQLSERVER_PORT || "1433");
  const tdsVersion = env.SQLSERVER_TDS_VERSION?.trim() || "7_1";
  if (!supportedTdsVersions.has(tdsVersion)) {
    throw new Error("SQLSERVER_TDS_VERSION must be 7_1 for SQL Server 2000");
  }

  return {
    server: requiredValue(env, "SQLSERVER_HOST"),
    port,
    user: requiredValue(env, "SQLSERVER_USER"),
    password: requiredValue(env, "SQLSERVER_PASSWORD"),
    database: requiredValue(env, "SQLSERVER_DATABASE"),
    connectionTimeout: parsePositiveInteger(env.SQLSERVER_CONNECTION_TIMEOUT_MS || "15000", "SQLSERVER_CONNECTION_TIMEOUT_MS"),
    requestTimeout: parsePositiveInteger(env.SQLSERVER_REQUEST_TIMEOUT_MS || "15000", "SQLSERVER_REQUEST_TIMEOUT_MS"),
    pool: {
      max: parsePositiveInteger(env.SQLSERVER_POOL_MAX || "5", "SQLSERVER_POOL_MAX"),
      min: 0,
      idleTimeoutMillis: parsePositiveInteger(env.SQLSERVER_POOL_IDLE_TIMEOUT_MS || "30000", "SQLSERVER_POOL_IDLE_TIMEOUT_MS")
    },
    options: {
      encrypt: parseBoolean(env.SQLSERVER_ENCRYPT, false, "SQLSERVER_ENCRYPT"),
      trustServerCertificate: true,
      tdsVersion
    }
  };
}

function requiredValue(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SQLSERVER_PORT must be a valid TCP port");
  }
  return port;
}

function parsePositiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return number;
}

function parseBoolean(value, fallback, name) {
  if (value == null || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}
