import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("overlay deployment cleanup removes obsolete components and retired tests while preserving runtime files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repair-deploy-cleanup-"));
  try {
    const files = [
      "client/src/features/access/DingTalkRoleMappings.tsx",
      "client/src/features/access/MappingEditor.tsx",
      "test/legacyWorkOrderRepository.test.mjs",
      "client/src/features/access/AccessSettingsPage.tsx",
      ".env.production", "server/data/uploads/license.jpg", ".pm2/dump.pm2",
      ".npm-cache/_cacache/content", "test/legacyRefresh.test.mjs"
    ];
    for (const file of files) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), "preserve-me");
    }
    const script = fileURLToPath(new URL("../scripts/clean-obsolete-deployment-files.mjs", import.meta.url));
    const run = () => spawnSync(process.execPath, [script, root], { encoding: "utf8" });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    for (const file of files.slice(0, 3)) await assert.rejects(access(path.join(root, file)), { code: "ENOENT" });
    for (const file of files.slice(3)) assert.equal(await readFile(path.join(root, file), "utf8"), "preserve-me");
    assert.equal(run().status, 0, "cleanup must also work when obsolete files are already absent");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
