import { createWriteStream, existsSync, renameSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";

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

// Stream into gzip at maximum compression; keep the old package if archiving fails.
const temporaryPath = `${outputPath}.${process.pid}.tmp`;
const tar = spawn("tar", ["-cf", "-", ...tarOptions, ...deploymentFiles], {
  cwd: projectRoot, stdio: ["ignore", "pipe", "inherit"], shell: false
});
const completed = new Promise((resolve, reject) => {
  tar.once("error", reject);
  tar.once("close", code => code === 0 ? resolve() : reject(new Error(`tar failed with exit code ${code}`)));
});
try {
  const results = await Promise.allSettled([
    completed,
    pipeline(tar.stdout, createGzip({ level: 9 }), createWriteStream(temporaryPath))
      .catch(error => { tar.kill(); throw error; })
  ]);
  const failed = results.find(result => result.status === "rejected");
  if (failed) throw failed.reason;
  renameSync(temporaryPath, outputPath);
} finally {
  rmSync(temporaryPath, { force: true });
}

const sizeInBytes = statSync(outputPath).size;
console.log(`Deployment package: ${outputPath}`);
console.log(`Deployment package size: ${(sizeInBytes / 1024 / 1024).toFixed(2)} MB`);
