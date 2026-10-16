import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appPath = path.resolve(process.argv[2] || fileURLToPath(new URL("..", import.meta.url)));
// Overlay extraction cannot remove files deleted from Git. Keep this explicit
// allowlist limited to retired source/test files; never remove runtime data.
const obsoleteFiles = [
  "client/src/features/access/DingTalkRoleMappings.tsx",
  "client/src/features/access/MappingEditor.tsx",
  "test/legacyWorkOrderRepository.test.mjs"
];
for (const relativePath of obsoleteFiles) {
  await rm(path.join(appPath, relativePath), { force: true });
}
console.log("Obsolete deployment files cleaned up.");
