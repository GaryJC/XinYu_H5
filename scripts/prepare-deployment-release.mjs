import { cp, mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const entries = ["client", "server", "shared", "scripts", "supabase", "test", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.node.json", "vite.config.ts", ".env.production"];

export async function prepareDeploymentRelease(appPath, processName, port) {
  const root = path.resolve(appPath);
  const config = spawnSync(process.execPath, ["--env-file=.env.production", "--input-type=module", "-e",
    'console.log(JSON.stringify({port:process.env.API_PORT||"8787",uploads:process.env.LOCAL_UPLOAD_ROOT||"server/data/uploads"}))'],
  { cwd: root, encoding: "utf8", windowsHide: true });
  if (config.status !== 0) throw new Error("Could not read production deployment configuration");
  const settings = JSON.parse(config.stdout);
  if (Number(settings.port) !== Number(port)) throw new Error("Port mismatch between deployment and .env.production");
  const releaseId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const releasePath = path.join(root, ".releases", releaseId);
  await mkdir(releasePath, { recursive: true });
  const dataPath = path.join(root, "server", "data");
  await mkdir(dataPath, { recursive: true });
  for (const entry of entries) {
    await cp(path.join(root, entry), path.join(releasePath, entry), {
      recursive: true,
      filter: source => source !== dataPath && ![".DS_Store", ".temp", ".branches"].includes(path.basename(source))
    });
  }
  await symlink(dataPath, path.join(releasePath, "server", "data"), process.platform === "win32" ? "junction" : "dir");
  // Absolute paths preserve uploaded files when PM2 changes the working directory.
  const options = {
    name: processName, cwd: releasePath, script: path.join(releasePath, "server", "server.mjs"),
    interpreter: process.execPath, node_args: ["--env-file=.env.production"],
    autorestart: true, max_restarts: 10, restart_delay: 2000, time: true,
    env: { LOCAL_UPLOAD_ROOT: path.resolve(root, settings.uploads), STATIC_DIR: path.join(releasePath, "dist"), DEPLOYMENT_RELEASE: releaseId }
  };
  await writeFile(path.join(releasePath, "ecosystem.release.config.cjs"), `module.exports = ${JSON.stringify({ apps: [options] }, null, 2)};\n`);
  await writeFile(path.join(releasePath, "release.json"), JSON.stringify({ root, releaseId, releasePath, processName, port: Number(port), options }));
  const lock = JSON.parse(await readFile(path.join(releasePath, "package-lock.json"), "utf8"));
  return { releasePath, releaseId, pm2Version: lock.packages["node_modules/pm2"].version };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [root, name, port] = process.argv.slice(2);
    if (!root || !name || !port) throw new Error("Expected application path, process name and port");
    console.log(JSON.stringify(await prepareDeploymentRelease(root, name, port)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
