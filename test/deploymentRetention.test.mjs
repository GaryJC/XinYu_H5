import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cleanupDeploymentReleases } from '../scripts/cleanup-deployment-releases.mjs';
import { preserveDeploymentAssets } from '../scripts/preserve-deployment-assets.mjs';

const link = (target, destination) => symlink(target, destination, process.platform === 'win32' ? 'junction' : 'dir');
async function fixture(root, id, processName = 'app') {
  const folder = path.join(root, '.releases', id);
  await mkdir(path.join(folder, 'dist/assets'), { recursive: true });
  const manifest = { root, releasePath: folder, releaseId: id, processName };
  await writeFile(path.join(folder, 'release.json'), JSON.stringify(manifest));
  await writeFile(path.join(folder, 'dist/assets', `${id}.js`), id);
  return manifest;
}
const processAt = folder => ({ pm2_env: { pm_cwd: folder } });

test('retention preserves actual current/previous, every live process, and shared data behind junctions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'release-retention-'));
  const external = await mkdtemp(path.join(os.tmpdir(), 'release-external-'));
  try {
    const current = await fixture(root, 'current'), previous = await fixture(root, 'previous');
    const older = await fixture(root, 'older'), failed = await fixture(root, 'failed');
    const other = await fixture(root, 'other', 'another-app'), busy = await fixture(root, 'busy');
    const uploads = path.join(root, 'server/data');
    await mkdir(uploads, { recursive: true }); await writeFile(path.join(uploads, 'photo.jpg'), 'upload');
    await writeFile(path.join(external, 'outside.txt'), 'outside');
    await mkdir(path.join(older.releasePath, 'server'));
    await link(uploads, path.join(older.releasePath, 'server/data'));
    await link(external, path.join(failed.releasePath, 'external'));
    await mkdir(path.join(root, '.releases/unrecognized'));
    await link(external, path.join(root, '.releases/manual-link'));
    await link(path.join(current.releasePath, 'dist'), path.join(root, 'dist'));
    for (const r of [older, previous, current]) await link(path.join(previous.releasePath, 'dist'), path.join(root, '.releases', `${r.releaseId}-previous-dist`));
    const result = await cleanupDeploymentReleases(current, processAt(previous.releasePath), [processAt(current.releasePath), processAt(busy.releasePath)]);
    assert.ok(result.removed.includes('older')); assert.ok(result.removed.includes('failed'));
    for (const r of [current, previous, busy, other]) await access(r.releasePath);
    for (const r of [older, failed]) await assert.rejects(access(r.releasePath), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(uploads, 'photo.jpg'), 'utf8'), 'upload');
    assert.equal(await readFile(path.join(external, 'outside.txt'), 'utf8'), 'outside');
    await access(path.join(root, '.releases/manual-link')); await access(path.join(root, '.releases/unrecognized'));
    assert.ok(result.skipped.includes('unrecognized'));
    await cleanupDeploymentReleases(current, processAt(previous.releasePath), [processAt(busy.releasePath)]);
  } finally { await rm(root, { recursive: true, force: true }); await rm(external, { recursive: true, force: true }); }
});

test('legacy root rollback retains its original static backup; subsequent releases remove it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'release-legacy-'));
  try {
    const current = await fixture(root, 'first');
    const backup = path.join(root, '.releases/first-previous-dist');
    await mkdir(backup); await writeFile(path.join(backup, 'index.html'), 'legacy');
    await cleanupDeploymentReleases(current, processAt(root));
    assert.equal(await readFile(path.join(backup, 'index.html'), 'utf8'), 'legacy');
    const next = await fixture(root, 'next');
    await cleanupDeploymentReleases(next, processAt(current.releasePath));
    await assert.rejects(access(backup), { code: 'ENOENT' });
    await access(current.releasePath); await access(next.releasePath);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('retention refuses linked release storage and preserves a release reached through a live alias', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'release-links-'));
  try {
    const current = await fixture(root, 'current'), busy = await fixture(root, 'busy');
    const alias = path.join(root, 'live-alias'); await link(busy.releasePath, alias);
    await cleanupDeploymentReleases(current, undefined, [processAt(alias)]); await access(busy.releasePath);
    await rm(alias);
    await rm(path.join(root, '.releases'), { recursive: true });
    await mkdir(path.join(root, 'external')); await link(path.join(root, 'external'), path.join(root, '.releases'));
    await assert.rejects(cleanupDeploymentReleases(current), /real directory/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('asset compatibility is limited to the previous build instead of growing across releases', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'release-assets-'));
  try {
    const a = await fixture(root, 'a'), b = await fixture(root, 'b'), c = await fixture(root, 'c'), d = await fixture(root, 'd');
    await preserveDeploymentAssets(processAt(a.releasePath), b);
    await preserveDeploymentAssets(processAt(b.releasePath), c);
    await preserveDeploymentAssets(processAt(b.releasePath), c); // Retrying must not change its own inventory.
    await preserveDeploymentAssets(processAt(c.releasePath), d);
    await access(path.join(c.releasePath, 'dist/assets/b.js')); await access(path.join(c.releasePath, 'dist/assets/c.js'));
    await assert.rejects(access(path.join(c.releasePath, 'dist/assets/a.js')), { code: 'ENOENT' });
    await access(path.join(d.releasePath, 'dist/assets/c.js')); await access(path.join(d.releasePath, 'dist/assets/d.js'));
    await assert.rejects(access(path.join(d.releasePath, 'dist/assets/b.js')), { code: 'ENOENT' });
    await writeFile(path.join(c.releasePath, '.deployment-assets.json'), JSON.stringify(['../release.json']));
    await assert.rejects(preserveDeploymentAssets(processAt(c.releasePath), d), /Unsafe/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
