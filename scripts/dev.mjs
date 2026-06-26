import { spawn } from "node:child_process";

const commands = [
  ["node", ["server/server.mjs"]],
  ["vite", ["--host", "0.0.0.0", "--port", "5173"]]
];

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
