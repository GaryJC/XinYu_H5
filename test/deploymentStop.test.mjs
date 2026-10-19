import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stopDeploymentApp } from "../scripts/stop-deployment-app.mjs";

function fake(processes, stopError) {
  const stopped = []; let disconnected = false;
  return {
    stopped, get disconnected() { return disconnected; },
    connect: callback => callback(null),
    list: callback => callback(null, processes),
    stop: (id, callback) => { stopped.push(id); callback(stopError); },
    disconnect: () => { disconnected = true; }
  };
}
const target = { name: "xinyu-h5", pm_id: 1, pid: 1234, pm2_env: { pm_cwd: "/apps/production" } };
const options = { appPath: "/apps/production", processName: "xinyu-h5", isAlive: () => false, delay: async () => {} };
test("only the named application in the intended directory is stopped", async () => {
  const pm2 = fake([target, { ...target, name: "xinyu-h5-test", pm_id: 2 }]);
  assert.deepEqual(await stopDeploymentApp(pm2, options), { stopped: 1 });
  assert.deepEqual(pm2.stopped, [1]); assert.equal(pm2.disconnected, true);
});
test("first deployment with no registered application succeeds", async () => {
  const pm2 = fake([]);
  assert.deepEqual(await stopDeploymentApp(pm2, options), { stopped: 0 });
  assert.deepEqual(pm2.stopped, []);
});
test("same name under another directory is rejected before any stop", async () => {
  const pm2 = fake([target, { ...target, pm_id: 2, pm2_env: { pm_cwd: "/apps/test" } }]);
  await assert.rejects(() => stopDeploymentApp(pm2, options), /another directory/);
  assert.deepEqual(pm2.stopped, []); assert.equal(pm2.disconnected, true);
});
test("dependency replacement waits until all old processes exit", async () => {
  const pm2 = fake([target]); let probes = 0; let waits = 0;
  await stopDeploymentApp(pm2, { ...options, isAlive: pid => { assert.equal(pid, 1234); return ++probes < 3; }, delay: async () => { waits++; } });
  assert.equal(waits, 2);
});
test("a locked process or failed PM2 stop prevents installation", async () => {
  const pm2 = fake([target]);
  await assert.rejects(() => stopDeploymentApp(pm2, { ...options, isAlive: () => true, attempts: 2 }), /have not exited/);
  assert.equal(pm2.disconnected, true);
  const broken = fake([target], new Error("stop failed"));
  await assert.rejects(() => stopDeploymentApp(broken, options), /stop failed/);
  assert.equal(broken.disconnected, true);
});
test("deployment prepares isolated PM2 and stops the app before npm ci", async () => {
  const script = await readFile(new URL("../scripts/deploy-windows.ps1", import.meta.url), "utf8");
  assert.ok(script.indexOf("--prefix") < script.indexOf("stop-deployment-app.mjs"));
  assert.ok(script.indexOf("stop-deployment-app.mjs") < script.indexOf("npm.cmd ci"));
  assert.match(script, /\.deploy-tools/);
  assert.ok(script.indexOf("npm.cmd ci") < script.indexOf("npm.cmd run check"));
  assert.ok(script.indexOf("npm.cmd run check") < script.indexOf("npm.cmd run migrate"));
  assert.ok(script.indexOf("npm.cmd run migrate") < script.indexOf("startOrReload"));
});
