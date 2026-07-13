import { spawn } from "node:child_process";

const apiPort = process.env.API_PORT || "8787";
const viteHost = process.env.VITE_HOST || "0.0.0.0";
const vitePort = process.env.VITE_PORT || "5173";

const commands = [
  ["node", ["server/server.mjs"]],
  ["vite", ["--host", viteHost, "--port", vitePort]]
];

process.env.API_PORT = apiPort;
process.env.API_PROXY_TARGET ||= `http://localhost:${apiPort}`;
process.env.APP_ENV = "development";
process.env.ENABLE_DEV_AUTH = "true";
process.env.JWT_SECRET ||= "repair-h5-local-development-only-secret";

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
