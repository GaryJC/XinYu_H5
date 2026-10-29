import { statfs } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const gib = 1024 ** 3;
export async function checkDeploymentSpace(paths, minimumGB = 4, inspect = statfs) {
  if (!Number.isFinite(minimumGB) || minimumGB <= 0 || !paths.length) throw new Error('Expected a positive minimum free space (GiB) and deployment paths');
  const results = [];
  for (const directory of [...new Set(paths.map(value => path.resolve(value)))]) {
    const disk = await inspect(directory);
    const availableGB = Number(disk.bavail) * Number(disk.bsize) / gib;
    if (!Number.isFinite(availableGB)) throw new Error(`Could not determine free space for ${directory}`);
    if (availableGB < minimumGB) throw new Error(`Insufficient disk space at ${directory}: ${availableGB.toFixed(2)} GiB available; at least ${minimumGB} GiB required. Free space or expand the volume before retrying. Previous application has not been switched.`);
    results.push({ directory, availableGB });
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [minimum, ...paths] = process.argv.slice(2);
    for (const disk of await checkDeploymentSpace(paths, Number(minimum))) console.log(`Disk space: ${disk.directory}: ${disk.availableGB.toFixed(2)} GiB available`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
