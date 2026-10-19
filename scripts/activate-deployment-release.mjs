import { access, cp, lstat, readFile, rename, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const call = (pm2, method, ...args) => new Promise((resolve, reject) => {
  pm2[method](...args, (error, result) => error ? reject(error instanceof Error ? error : new Error(String(error?.message || error?.error || error))) : resolve(result));
});
const normalize = value => path.resolve(value).replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
export function isManagedDirectory(root, directory) {
  if (!directory) return false;
  const base = normalize(root), candidate = normalize(directory);
  return candidate === base || path.posix.dirname(candidate) === `${base}/.releases`;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const isAlive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
};
async function waitForExit(pids, alive, pause) {
  for (let i = 0; i < 50; i++) {
    if (!pids.some(alive)) return;
    await pause(200);
  }
  throw new Error("Previous application processes have not exited");
}
export async function waitForRelease(port, releaseId, { request = fetch, pause = delay, attempts = 30 } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await request(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok && (await response.json()).ok === true &&
          (!releaseId || response.headers.get("x-deployment-release") === releaseId)) return;
    } catch { /* PM2 may still be starting the server. */ }
    await pause(1000);
  }
  throw new Error("Application health check failed");
}

// Keep a fixed Nginx/IIS static root working while the Node process runs from a release directory.
export async function publishStaticRoot(root, releasePath, releaseId) {
  const live = path.join(root, "dist");
  const next = path.join(root, `.dist-next-${releaseId}`);
  const backup = path.join(root, ".releases", `${releaseId}-previous-dist`);
  await symlink(path.join(releasePath, "dist"), next, process.platform === "win32" ? "junction" : "dir");
  let hadPrevious = false;
  try {
    try { await lstat(live); hadPrevious = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (hadPrevious) await rename(live, backup);
    try { await rename(next, live); }
    catch (error) { if (hadPrevious) await rename(backup, live); throw error; }
  } finally {
    // next is a directory symlink/junction: never recursively delete its target.
    await rm(next, { force: true });
  }
  return async () => {
    await rm(live, { force: true });
    if (hadPrevious) await rename(backup, live);
  };
}

export async function activateDeploymentRelease(pm2, release, {
  healthy = waitForRelease, alive = isAlive, pause = delay, publish = publishStaticRoot,
  preserveAssets = async previous => {
    const source = path.join(previous.pm2_env.pm_cwd, "dist", "assets");
    try { await access(source); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    await cp(source, path.join(release.releasePath, "dist", "assets"), { recursive: true, force: false, errorOnExist: false });
  }
} = {}) {
  let previous, changed = false, undoStatic;
  try {
    await call(pm2, "connect");
    const targets = (await call(pm2, "list")).filter(item => item.name === release.processName);
    if (targets.length > 1) throw new Error("Multiple same-name PM2 applications; deployment stopped");
    previous = targets[0];
    if (previous && !isManagedDirectory(release.root, previous.pm2_env?.pm_cwd)) {
      throw new Error("PM2 application belongs to another directory; deployment stopped");
    }
    if (previous) {
      await preserveAssets(previous);
      // A root installation is migrated once. Never replace its node_modules.
      changed = true;
      await call(pm2, "delete", previous.pm_id);
      await waitForExit(previous.pid > 0 ? [previous.pid] : [], alive, pause);
    } else { changed = true; }
    await call(pm2, "start", release.options);
    await healthy(release.port, release.releaseId);
    undoStatic = await publish(release.root, release.releasePath, release.releaseId);
    await call(pm2, "dump", true);
    return { releaseId: release.releaseId };
  } catch (error) {
    if (!changed) throw error;
    try {
      if (undoStatic) await undoStatic();
      const current = (await call(pm2, "list")).filter(item => item.name === release.processName);
      for (const item of current) {
        if (!isManagedDirectory(release.root, item.pm2_env?.pm_cwd)) throw new Error("Cannot roll back an unrelated application");
        await call(pm2, "delete", item.pm_id);
        await waitForExit(item.pid > 0 ? [item.pid] : [], alive, pause);
      }
      if (previous) {
        await waitForExit(previous.pid > 0 ? [previous.pid] : [], alive, pause);
        const env = previous.pm2_env;
        await call(pm2, "start", {
          name: release.processName, script: env.pm_exec_path, cwd: env.pm_cwd,
          interpreter: env.exec_interpreter, node_args: env.node_args,
          env: env.env, autorestart: env.autorestart, restart_delay: env.restart_delay,
          max_restarts: env.max_restarts, time: true
        });
        await healthy(release.port, env.env?.DEPLOYMENT_RELEASE);
      }
      await call(pm2, "dump", true);
    } catch (rollbackError) {
      throw new Error(`Release activation failed: ${error.message}; rollback failed: ${rollbackError.message}`);
    }
    throw new Error(`Release activation failed: ${error.message}; ${previous ? "previous application restored" : "failed application removed"}`);
  } finally { await call(pm2, "disconnect").catch(() => undefined); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [releasePath, pm2Path] = process.argv.slice(2);
    if (!releasePath || !pm2Path) throw new Error("Expected release directory and standalone PM2 path");
    const release = JSON.parse(await readFile(path.join(releasePath, "release.json"), "utf8"));
    const require = createRequire(import.meta.url);
    const result = await activateDeploymentRelease(require(path.resolve(pm2Path)), release);
    process.stdout.write(`Deployment succeeded: release ${result.releaseId}\n`, () => process.exit(0));
  } catch (error) { process.stderr.write(`${error.message}\n`, () => process.exit(1)); }
}
