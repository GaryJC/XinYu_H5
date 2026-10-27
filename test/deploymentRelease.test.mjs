import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareDeploymentRelease } from "../scripts/prepare-deployment-release.mjs";
import { activateDeploymentRelease, isManagedDirectory, publishStaticRoot, waitForRelease } from "../scripts/activate-deployment-release.mjs";

const release = { root: "/apps/production", releasePath: "/apps/production/.releases/new", processName: "xinyu-h5", releaseId: "new", port: 8787,
  options: { name: "xinyu-h5", cwd: "/apps/production/.releases/new", script: "/apps/production/.releases/new/server/server.mjs" } };
const old = { pm_id: 1, pid: 123, name: "xinyu-h5", pm2_env: { pm_cwd: "/apps/production/.releases/old", pm_exec_path: "/apps/production/.releases/old/server/server.mjs", env: { DEPLOYMENT_RELEASE: "old", LOCAL_UPLOAD_ROOT: "/shared/uploads" } } };
function fake(previous = old, { failStart = false } = {}) {
  let entries = previous ? [previous] : [], disconnected = false, starts = 0;
  const calls = [];
  return { calls, get disconnected() { return disconnected; },
    connect(cb) { cb(null); }, list(cb) { cb(null, entries); },
    delete(id, cb) { calls.push(["delete", id]); entries = entries.filter(e => e.pm_id !== id); cb(null); },
    start(options, cb) {
      calls.push(["start", options]);
      if (failStart && ++starts === 1) return cb(new Error("spawn failed"));
      entries.push({ name: options.name, pm_id: 2, pid: 456, pm2_env: { pm_cwd: options.cwd } }); cb(null);
    },
    dump(force, cb) { assert.equal(force, true); calls.push(["dump"]); cb(null); }, disconnect(cb) { disconnected = true; cb(null); }
  };
}
const deps = { alive: () => false, pause: async () => {}, preserveAssets: async () => {}, publish: async () => async () => {}, healthy: async () => {} };

test("preparing a release preserves live dependencies, build, uploads and excludes development env", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repair-release-"));
  try {
    for (const dir of ["client", "server/data/uploads", "shared", "scripts", "supabase", "test", "node_modules", "dist"]) await mkdir(path.join(root, dir), { recursive: true });
    for (const entry of ["package.json", "tsconfig.json", "tsconfig.node.json", "vite.config.ts"]) await writeFile(path.join(root, entry), "{}");
    await writeFile(path.join(root, "package-lock.json"), JSON.stringify({ packages: { "node_modules/pm2": { version: "7.0.3" } } }));
    await writeFile(path.join(root, ".env.production"), "API_PORT=8787\nLOCAL_UPLOAD_ROOT=server/data/uploads\n");
    await writeFile(path.join(root, ".env.local"), "DO_NOT_COPY=true\n");
    await writeFile(path.join(root, "dist/index.html"), "live frontend");
    await writeFile(path.join(root, "node_modules/locked.dll"), "live dependencies");
    await writeFile(path.join(root, "server/data/uploads/license.jpg"), "live upload");
    const result = await prepareDeploymentRelease(root, "test-app", 8787);
    const manifest = JSON.parse(await readFile(path.join(result.releasePath, "release.json"), "utf8"));
    assert.equal(await readFile(path.join(root, "node_modules/locked.dll"), "utf8"), "live dependencies");
    assert.equal(await readFile(path.join(root, "dist/index.html"), "utf8"), "live frontend");
    assert.equal(await readFile(path.join(result.releasePath, "server/data/uploads/license.jpg"), "utf8"), "live upload");
    assert.equal(await realpath(path.join(result.releasePath, "server/data")), await realpath(path.join(root, "server/data")));
    assert.equal(manifest.options.env.LOCAL_UPLOAD_ROOT, path.join(root, "server/data/uploads"));
    for (const entry of ["node_modules", "dist", ".env.local"]) await assert.rejects(readFile(path.join(result.releasePath, entry)), { code: "ENOENT" });
    await assert.rejects(() => prepareDeploymentRelease(root, "test-app", 9999), /Port mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("staged source never replaces live code and uses only live configuration and uploads", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "repair-staged-"));
  const root = path.join(base, "live"), source = path.join(base, "artifact");
  try {
    for (const directory of [root, source]) {
      for (const entry of ["client", "server/data/uploads", "shared", "scripts", "supabase", "test", "dist", "node_modules"])
        await mkdir(path.join(directory, entry), { recursive: true });
      await writeFile(path.join(directory, "server/server.mjs"), directory === root ? "old code" : "new code");
      await writeFile(path.join(directory, "server/data/uploads/photo.jpg"), directory === root ? "live upload" : "artifact upload");
      await writeFile(path.join(directory, ".env.production"), directory === root ? "API_PORT=8787\n" : "API_PORT=9999\n");
    }
    for (const entry of ["package.json", "tsconfig.json", "tsconfig.node.json", "vite.config.ts"])
      await writeFile(path.join(source, entry), "{}");
    await writeFile(path.join(source, "package-lock.json"), JSON.stringify({ packages: { "node_modules/pm2": { version: "7.0.3" } } }));
    await writeFile(path.join(root, "dist/index.html"), "old frontend");
    await writeFile(path.join(root, "node_modules/locked.dll"), "old dependency");
    await writeFile(path.join(root, "server/retired.mjs"), "old file not in artifact");
    const result = await prepareDeploymentRelease(root, "test-app", 8787, source);
    assert.equal(await readFile(path.join(result.releasePath, "server/server.mjs"), "utf8"), "new code");
    assert.equal(await readFile(path.join(result.releasePath, ".env.production"), "utf8"), "API_PORT=8787\n");
    assert.equal(await readFile(path.join(result.releasePath, "server/data/uploads/photo.jpg"), "utf8"), "live upload");
    assert.equal(await readFile(path.join(root, "server/server.mjs"), "utf8"), "old code");
    assert.equal(await readFile(path.join(root, "dist/index.html"), "utf8"), "old frontend");
    assert.equal(await readFile(path.join(root, "node_modules/locked.dll"), "utf8"), "old dependency");
    for (const entry of ["server/retired.mjs", "dist", "node_modules"])
      await assert.rejects(readFile(path.join(result.releasePath, entry)), { code: "ENOENT" });
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("only root and immediate release directories are managed", () => {
  assert.equal(isManagedDirectory(release.root, release.root), true);
  assert.equal(isManagedDirectory(release.root, old.pm2_env.pm_cwd), true);
  for (const dir of ["/apps/production-other", "/apps/production/.releases", "/apps/production/.releases/x/nested", "/apps/unrelated"]) assert.equal(isManagedDirectory(release.root, dir), false);
});
test("successful activation stops only after assets are preserved and health precedes static publication", async () => {
  const pm2 = fake(); const stages = [];
  await activateDeploymentRelease(pm2, release, { ...deps,
    preserveAssets: async () => { assert.equal(pm2.calls.length, 0); stages.push("assets"); },
    healthy: async (port, id) => { assert.equal(port, 8787); assert.equal(id, "new"); stages.push("healthy"); },
    publish: async () => { stages.push("publish"); return async () => {}; }
  });
  assert.deepEqual(stages, ["assets", "healthy", "publish"]);
  assert.deepEqual(pm2.calls.map(c => c[0]), ["delete", "start", "dump"]);
  assert.equal(pm2.disconnected, true);
});
test("preflight failures leave the current application running", async () => {
  for (const [previous, overrides, pattern] of [
    [{ ...old, pm2_env: { pm_cwd: "/apps/other" } }, {}, /another directory/],
    [old, { preserveAssets: async () => { throw new Error("disk full"); } }, /disk full/]
  ]) {
    const pm2 = fake(previous);
    await assert.rejects(() => activateDeploymentRelease(pm2, release, { ...deps, ...overrides }), pattern);
    assert.deepEqual(pm2.calls, []);
  }
});
test("failed startup or health restores the previous version and its environment", async () => {
  for (const failStart of [false, true]) {
    const pm2 = fake(old, { failStart }); const health = [];
    await assert.rejects(() => activateDeploymentRelease(pm2, release, { ...deps, healthy: async (port, id) => {
      health.push(id); if (id === "new") throw new Error("unhealthy candidate");
    } }), /previous application restored/);
    const restored = pm2.calls.filter(c => c[0] === "start").at(-1)[1];
    assert.equal(restored.cwd, old.pm2_env.pm_cwd);
    assert.deepEqual(restored.env, old.pm2_env.env);
    assert.equal(health.at(-1), "old");
  }
});
test("first deployment removes an unhealthy candidate without inventing a rollback target", async () => {
  const pm2 = fake(null);
  await assert.rejects(() => activateDeploymentRelease(pm2, release, { ...deps, healthy: async () => { throw new Error("not healthy"); } }), /failed application removed/);
  assert.deepEqual(pm2.calls.map(c => c[0]), ["start", "delete", "dump"]);
});
test("rollback failure is reported explicitly", async () => {
  await assert.rejects(() => activateDeploymentRelease(fake(), release, { ...deps, healthy: async () => { throw new Error("database offline"); } }), /rollback failed/);
});
test("health check rejects a healthy response from the wrong release", async () => {
  let requests = 0;
  await waitForRelease(8787, "new", { pause: async () => {}, attempts: 2, request: async () => ({
    ok: true, json: async () => ({ ok: true }), headers: new Headers({ "x-deployment-release": ++requests === 1 ? "old" : "new" })
  }) });
  assert.equal(requests, 2);
  await assert.rejects(() => waitForRelease(8787, "new", { pause: async () => {}, attempts: 1, request: async () => ({
    ok: true, json: async () => ({ ok: true }), headers: new Headers()
  }) }), /health check failed/);
});
test("fixed static root can be switched and restored without deleting either version", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repair-static-"));
  try {
    const candidate = path.join(root, ".releases", "new");
    await mkdir(path.join(candidate, "dist"), { recursive: true }); await mkdir(path.join(root, "dist"));
    await writeFile(path.join(root, "dist/index.html"), "old"); await writeFile(path.join(candidate, "dist/index.html"), "new");
    const undo = await publishStaticRoot(root, candidate, "new");
    assert.equal(await readFile(path.join(root, "dist/index.html"), "utf8"), "new");
    await undo();
    assert.equal(await readFile(path.join(root, "dist/index.html"), "utf8"), "old");
    assert.equal(await readFile(path.join(candidate, "dist/index.html"), "utf8"), "new");
  } finally { await rm(root, { recursive: true, force: true }); }
});
