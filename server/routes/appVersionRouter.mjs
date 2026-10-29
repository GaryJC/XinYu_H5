import { readAppVersion } from '../services/appVersionService.mjs';
import { sendJson } from '../http/response.mjs';

export async function handleAppVersion(req, res, url, readVersion = readAppVersion) {
  if (req.method !== 'GET' || url.pathname !== '/api/app-version') return false;
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  sendJson(res, 200, await readVersion());
  return true;
}
