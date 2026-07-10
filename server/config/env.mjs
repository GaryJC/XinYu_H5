export function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function serverConfig() {
  const port = Number(process.env.API_PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("API_PORT must be a valid TCP port");
  }

  return {
    port,
    distDir: process.env.STATIC_DIR || "dist"
  };
}
