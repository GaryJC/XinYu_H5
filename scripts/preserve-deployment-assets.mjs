import { constants } from 'node:fs';
import { access, copyFile, lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const inventoryName = '.deployment-assets.json';
async function inventory(directory, prefix = '') {
  const files = [];
  for (const name of await readdir(path.join(directory, prefix))) {
    const relative = path.join(prefix, name), info = await lstat(path.join(directory, relative));
    if (info.isSymbolicLink()) throw new Error('Unexpected link in deployment assets');
    if (info.isDirectory()) files.push(...await inventory(directory, relative));
    else if (info.isFile()) files.push(relative);
  }
  return files;
}
export async function preserveDeploymentAssets(previous, release) {
  const target = path.join(release.releasePath, 'dist', 'assets');
  // Record this build's own files before adding compatibility files from the preceding version.
  // Retrying activation must not reclassify inherited files as this build's own assets.
  const ownManifest = path.join(release.releasePath, inventoryName);
  try { await access(ownManifest); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    let own = [];
    try { own = await inventory(target); } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
    await writeFile(ownManifest, JSON.stringify(own));
  }
  const source = path.join(previous.pm2_env.pm_cwd, 'dist', 'assets');
  try { await access(source); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  let files;
  try { files = JSON.parse(await readFile(path.join(previous.pm2_env.pm_cwd, inventoryName), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; files = await inventory(source); }
  if (!Array.isArray(files)) throw new Error('Invalid deployment asset inventory');
  for (const file of files) {
    if (typeof file !== 'string' || path.isAbsolute(file) || file.split(/[\\/]/).some(part => part === '..' || part === '') || file.includes(':')) throw new Error('Unsafe deployment asset path');
    const from = path.join(source, file), to = path.join(target, file);
    const info = await lstat(from);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unexpected deployment asset type');
    await mkdir(path.dirname(to), { recursive: true });
    try { await copyFile(from, to, constants.COPYFILE_EXCL); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
}
