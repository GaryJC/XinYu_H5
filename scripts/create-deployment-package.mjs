import { existsSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputPath = resolve(
  projectRoot,
  process.argv[2] || process.env.DEPLOY_PACKAGE_PATH || "package.tgz"
);

const deploymentFiles = [
  "client",
  "server",
  "shared",
  "scripts",
  "supabase",
  "test",
  "ecosystem.config.cjs",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.node.json",
  "vite.config.ts"
];
const tarOptions = [
  "--exclude=server/data",
  "--exclude=.DS_Store"
];

const missingFiles = deploymentFiles.filter(
  (entry) => !existsSync(resolve(projectRoot, entry))
);
if (missingFiles.length > 0) {
  throw new Error(`Missing deployment files: ${missingFiles.join(", ")}`);
}

rmSync(outputPath, { force: true });

const result = spawnSync(
  "tar",
  ["-czf", outputPath, ...tarOptions, ...deploymentFiles],
  { cwd: projectRoot, stdio: "inherit", shell: false }
);
if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`tar failed with exit code ${result.status}`);
}

const sizeInBytes = statSync(outputPath).size;
console.log(`Deployment package: ${outputPath}`);
console.log(`Deployment package size: ${(sizeInBytes / 1024 / 1024).toFixed(2)} MB`);
