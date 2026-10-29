import { lstat, readdir, readFile, realpath, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';

const normalize = value => path.resolve(value).replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
const inside = (directory, file) => normalize(file) === normalize(directory) || normalize(file).startsWith(`${normalize(directory)}/`);
const exists = async file => { try { return await lstat(file); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; } };

// Never follow a release's server/data junction, or any other link, during removal.
async function removeTree(file) {
  const info = await exists(file);
  if (!info) return;
  if (info.isSymbolicLink() || !info.isDirectory()) { await rm(file, { force: true }); return; }
  for (const name of (await readdir(file)).sort((a, b) => Number(a === 'release.json') - Number(b === 'release.json'))) await removeTree(path.join(file, name));
  await rmdir(file);
}

export async function cleanupDeploymentReleases(release, previous, processes = []) {
  const directory = path.join(release.root, '.releases');
  const info = await exists(directory);
  if (!info) return { removed: [], skipped: [] };
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Release storage must be a real directory; cleanup skipped');
  const protectedPaths = [release.releasePath, previous?.pm2_env?.pm_cwd, previous?.pm2_env?.pm_exec_path,
    ...processes.flatMap(item => [item.pm2_env?.pm_cwd, item.pm2_env?.pm_exec_path])].filter(Boolean);
  for (const file of [...protectedPaths]) {
    try { protectedPaths.push(await realpath(file)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  // Protect the actual static root as well as every PM2 application, even an unrelated one.
  try { protectedPaths.push(await realpath(path.join(release.root, 'dist'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const managed = [];
  const skipped = [];
  for (const name of await readdir(directory)) {
    const folder = path.join(directory, name);
    const entry = await exists(folder);
    if (!entry?.isDirectory() || entry.isSymbolicLink()) continue;
    try {
      const manifest = JSON.parse(await readFile(path.join(folder, 'release.json'), 'utf8'));
      if (manifest.releaseId !== name || normalize(manifest.root) !== normalize(release.root) ||
          normalize(manifest.releasePath) !== normalize(folder) || manifest.processName !== release.processName) {
        skipped.push(name); continue;
      }
      managed.push({ name, folder });
    } catch { skipped.push(name); }
  }
  const removed = [];
  // Plan backups before removing manifests. Only touch backup names tied to validated releases.
  const backups = managed.map(item => path.join(directory, `${item.name}-previous-dist`));
  for (const backup of backups) {
    // A first migration from a root installation still needs its original static directory for rollback.
    if (previous && normalize(previous.pm2_env.pm_cwd) === normalize(release.root) &&
        backup === path.join(directory, `${release.releaseId}-previous-dist`)) continue;
    if (protectedPaths.some(file => inside(backup, file))) continue;
    if (await exists(backup)) { await removeTree(backup); removed.push(path.basename(backup)); }
  }
  const removeRelease = async item => {
    const canonicalFolder = await realpath(item.folder);
    if (protectedPaths.some(file => inside(item.folder, file) || inside(canonicalFolder, file))) return;
    await removeTree(item.folder);
    removed.push(item.name);
  };
  // Bound parallelism: Windows releases contain many small dependency files.
  for (let offset = 0; offset < managed.length; offset += 4) {
    const results = await Promise.allSettled(managed.slice(offset, offset + 4).map(removeRelease));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
  }
  const knownBackups = new Set(backups.map(file => path.basename(file)));
  return { removed, skipped: skipped.filter(name => !knownBackups.has(name)) };
}
