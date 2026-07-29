import { spawn } from "node:child_process";

const apiPort = process.env.API_PORT || "8787";
const viteHost = process.env.VITE_HOST || "0.0.0.0";
const vitePort = process.env.VITE_PORT || "5173";
const startLocalApi = process.env.START_LOCAL_API !== "false";

const commands = [["vite", ["--host", viteHost, "--port", vitePort]]];
if (startLocalApi) commands.unshift(["node", ["server/server.mjs"]]);

process.env.API_PORT = apiPort;
process.env.API_PROXY_TARGET ||= `http://localhost:${apiPort}`;
if (startLocalApi) {
  process.env.APP_ENV = "development";
  process.env.ENABLE_DEV_AUTH = "true";
  process.env.JWT_SECRET ||= "repair-h5-local-development-only-secret";
}

console.log(
  startLocalApi
    ? `Development API: local http://localhost:${apiPort}`
    : `Development API: remote ${process.env.API_PROXY_TARGET}`
);

const children = commands.map(([cmd, args]) => {
  const child = spawn(cmd, args, { stdio: "inherit", shell: true });
  child.on("exit", (code) => {
    if (code && code !== 0) {
      for (const other of children) {
        if (other !== child) other.kill("SIGTERM");
      }
      process.exit(code);
    }
  });
  return child;
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  for (const child of children) child.kill("SIGTERM");
  process.exit(0);
}
