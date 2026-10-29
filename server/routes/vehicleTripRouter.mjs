import { readJson, sendJson } from '../http/response.mjs';
import { HttpError } from '../http/HttpError.mjs';
import { findFileRecord } from '../repositories/fileRepository.mjs';
import { readStoredFile, readStoredThumbnail } from '../storage.mjs';
import { vehicleTripService as service } from '../services/vehicleTripService.mjs';

async function readInput(req) {
  const input = await readJson(req);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, '请求内容必须为对象');
  return input;
}

export async function handleVehicleTrips(req, res, url, user) {
  const fileMatch = url.pathname.match(/^\/api\/files\/([^/]+)\/content$/);
  if (fileMatch && req.method === 'GET') {
    const file = await findFileRecord(fileMatch[1]);
    if (!file.kind.startsWith('trip_')) return false;
    await service.authorizeFile(user, file.id);
    const stored = url.searchParams.get('size') === 'thumbnail' ? await readStoredThumbnail(file.id) : await readStoredFile(file.id);
    res.statusCode = 200;
    res.setHeader('Content-Type', stored.mimeType || stored.record.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', 'sandbox');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Authorization');
    res.end(stored.body);
    return true;
  }
  if (url.pathname === '/api/company-vehicles') {
    if (req.method === 'GET') sendJson(res, 200, await service.vehicles(user, url.searchParams.get('all') === 'true'));
    else if (req.method === 'POST') sendJson(res, 201, await service.saveVehicle(user, await readInput(req)));
    else throw new HttpError(405, '不支持的请求方法');
    return true;
  }
  const car = url.pathname.match(/^\/api\/company-vehicles\/([^/]+)$/);
  if (car) {
    if (req.method !== 'PUT') throw new HttpError(405, '不支持的请求方法');
    sendJson(res, 200, await service.saveVehicle(user, await readInput(req), car[1]));
    return true;
  }
  if (url.pathname === '/api/vehicle-trip-requests') {
    if (req.method === 'GET') sendJson(res, 200, await service.list(user));
    else if (req.method === 'POST') sendJson(res, 201, await service.create(user, await readInput(req)));
    else throw new HttpError(405, '不支持的请求方法');
    return true;
  }
  const trip = url.pathname.match(/^\/api\/vehicle-trip-requests\/([^/]+)(?:\/(approve|reject|cancel|depart|return|attachments))?$/);
  if (!trip) return false;
  if (!trip[2] && req.method === 'GET') sendJson(res, 200, await service.detail(user, trip[1]));
  else if (trip[2] && req.method === 'POST') {
    const input = await readInput(req);
    sendJson(res, 200, trip[2] === 'attachments' ? await service.upload(user, trip[1], input) : await service.act(user, trip[1], trip[2], input));
  } else throw new HttpError(405, '不支持的请求方法');
  return true;
}
