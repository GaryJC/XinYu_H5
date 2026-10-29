import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const enabled = process.env.DEPLOYMENT_PM2_TEST === "true";
test("real isolated PM2 switches releases and restores the old process after an unhealthy startup", { skip: !enabled, timeout: 60000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repair-pm2-release-"));
  const environment = { ...process.env, PM2_HOME: path.join(root, ".pm2"), PM2_SILENT: "true" };
  const pm2Path = fileURLToPath(new URL("../node_modules/pm2", import.meta.url));
  const activate = fileURLToPath(new URL("../scripts/activate-deployment-release.mjs", import.meta.url));
  const interpreter = path.join(root, process.platform === "win32" ? "node.exe" : "node");
  await symlink(process.execPath, interpreter);
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const fixture = async (id, healthy = true) => {
    const directory = path.join(root, ".releases", id);
    await mkdir(path.join(directory, "dist"), { recursive: true });
    await writeFile(path.join(directory, "dist/index.html"), id);
    const script = path.join(directory, "server.mjs");
    await writeFile(script, `import {createServer} from 'node:http';\ncreateServer((req,res)=>{res.setHeader('X-Deployment-Release',process.env.DEPLOYMENT_RELEASE);res.end(JSON.stringify({ok:${healthy}}))}).listen(${port},'127.0.0.1');\n`);
    await writeFile(path.join(directory, "release.json"), JSON.stringify({ root, releaseId: id, releasePath: directory, processName: "release-fixture", port,
      options: { name: "release-fixture", cwd: directory, script, interpreter, autorestart: false, env: { DEPLOYMENT_RELEASE: id } } }));
    return directory;
  };
  const run = directory => spawnSync(process.execPath, [activate, directory, pm2Path], { env: environment, encoding: "utf8", timeout: 45000 });
  try {
    for (const id of ["old", "next", "final"]) {
      const result = run(await fixture(id));
      assert.equal(result.status, 0, result.stderr || result.error?.message);
      assert.equal(await readFile(path.join(root, "dist/index.html"), "utf8"), id);
    }
    await assert.rejects(readFile(path.join(root, ".releases/old/release.json")), { code: "ENOENT" });
    await readFile(path.join(root, ".releases/next/release.json"));
    const failed = run(await fixture("broken", false));
    assert.equal(failed.status, 1, failed.stderr || failed.error?.message);
    assert.match(failed.stderr, /previous application restored/);
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(response.headers.get("x-deployment-release"), "final");
    assert.equal(await readFile(path.join(root, "dist/index.html"), "utf8"), "final");
  } finally {
    const cleanup = spawnSync(process.execPath, [path.join(pm2Path, "bin/pm2"), "kill"], { env: environment, encoding: "utf8", timeout: 10000 });
    assert.equal(cleanup.status, 0, cleanup.stderr);
    await rm(root, { recursive: true, force: true });
  }
});
