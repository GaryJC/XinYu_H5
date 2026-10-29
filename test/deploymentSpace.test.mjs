import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { checkDeploymentSpace } from '../scripts/check-deployment-space.mjs';

const gib = 1024 ** 3;
test('deployment preflight checks every distinct location and rejects insufficient usable space', async () => {
  const inspected = [];
  const inspect = async location => { inspected.push(location); return { bsize: 4096, bavail: inspected.length === 1 ? 8 * gib / 4096 : gib / 4096 }; };
  await assert.rejects(checkDeploymentSpace(['/app', '/app', '/cache'], 4, inspect), /Insufficient disk space.*1.00 GiB.*4 GiB/);
  assert.equal(inspected.length, 2);
});
test('deployment preflight accepts sufficient space and works against a real filesystem', async () => {
  const result = await checkDeploymentSpace(['/app'], 4, async () => ({ bsize: 4096n, bavail: BigInt(4 * gib / 4096) }));
  assert.equal(result[0].availableGB, 4);
  const actual = await checkDeploymentSpace([os.tmpdir()], Number.EPSILON);
  assert.ok(actual[0].availableGB > 0);
});
test('deployment preflight refuses invalid readings, paths and thresholds', async () => {
  for (const minimum of [0, -1, NaN, Infinity]) await assert.rejects(checkDeploymentSpace(['/app'], minimum));
  await assert.rejects(checkDeploymentSpace([], 4));
  await assert.rejects(checkDeploymentSpace(['/app'], 4, async () => ({ bsize: NaN, bavail: 10 })), /Could not determine/);
  await assert.rejects(checkDeploymentSpace(['/missing'], 4, async () => { throw new Error('missing path'); }), /missing path/);
});
