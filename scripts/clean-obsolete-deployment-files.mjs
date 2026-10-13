import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appPath = path.resolve(process.argv[2] || fileURLToPath(new URL("..", import.meta.url)));
// Deleted in d3728bf; overlay extraction can leave these incompatible components behind.
const obsoleteFiles = [
  "client/src/features/access/DingTalkRoleMappings.tsx",
  "client/src/features/access/MappingEditor.tsx"
];
for (const relativePath of obsoleteFiles) {
  await rm(path.join(appPath, relativePath), { force: true });
}
console.log("Obsolete access components cleaned up.");
