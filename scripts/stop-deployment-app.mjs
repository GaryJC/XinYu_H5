import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const call = (pm2, method, ...args) => new Promise((resolve, reject) => {
  pm2[method](...args, (error, result) => error ? reject(error) : resolve(result));
});

export async function stopDeploymentApp(pm2, {
  appPath, processName,
  isAlive = pid => {
    try { process.kill(pid, 0); return true; }
    catch (error) { if (error.code === "ESRCH") return false; throw error; }
  },
  delay = ms => new Promise(resolve => setTimeout(resolve, ms)),
  attempts = 50
}) {
  const normalize = value => path.resolve(value).replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
  try {
    await call(pm2, "connect");
    const processes = await call(pm2, "list");
    const targets = processes.filter(item => item.name === processName);
    // Never stop a same-name application registered under another directory.
    for (const item of targets) {
      if (!item.pm2_env?.pm_cwd || normalize(item.pm2_env.pm_cwd) !== normalize(appPath)) {
        throw new Error(`PM2 application ${processName} belongs to another directory; deployment stopped`);
      }
    }
    const pids = targets.map(item => Number(item.pid)).filter(pid => Number.isInteger(pid) && pid > 0);
    for (const item of targets) await call(pm2, "stop", item.pm_id);
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (!pids.some(isAlive)) return { stopped: targets.length };
      await delay(200);
    }
    throw new Error("Application processes have not exited; dependencies were not replaced");
  } finally {
    pm2.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [appPath, processName, pm2Path] = process.argv.slice(2);
  try {
    if (!appPath || !processName || !pm2Path) throw new Error("Expected application path, process name and standalone PM2 path");
    const require = createRequire(import.meta.url);
    const result = await stopDeploymentApp(require(path.resolve(pm2Path)), { appPath, processName });
    console.log(`Stopped ${result.stopped} matching application process(es); ready to replace dependencies.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
