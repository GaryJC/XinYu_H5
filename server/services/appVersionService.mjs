import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { serverConfig } from '../config/env.mjs';
import { HttpError } from '../http/HttpError.mjs';

export async function readAppVersion(distDir = serverConfig().distDir) {
  try {
    const manifest = JSON.parse(await readFile(path.join(distDir, 'app-version.json'), 'utf8'));
    if (typeof manifest.version !== 'string' || !manifest.version.trim() || manifest.version.length > 128) throw new Error('Invalid version');
    return { version: manifest.version };
  } catch {
    throw new HttpError(503, '应用版本暂不可用');
  }
}
