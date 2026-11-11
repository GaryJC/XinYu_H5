import {notificationUsage} from '../services/notificationUsageService.mjs';
import { readJson, sendJson } from '../http/response.mjs';
import { HttpError } from '../http/HttpError.mjs';
import { listNotificationDeliveries, queryNotificationDelivery } from '../services/notificationQueryService.mjs';

export async function handleNotifications(req, res, url, user) {
  if(url.pathname==='/api/notifications/usage') {
    if(req.method!=='GET')throw new HttpError(405,'不支持的请求方法');
    sendJson(res,200,await notificationUsage(user,url.searchParams));return true;
  }
  if (url.pathname === '/api/notifications') {
    if (req.method !== 'GET') throw new HttpError(405, '不支持的请求方法');
    sendJson(res, 200, await listNotificationDeliveries(user, url.searchParams.get('source'), url.searchParams.get('resourceId')));
    return true;
  }
  const match = url.pathname.match(/^\/api\/notifications\/([^/]+)\/([^/]+)\/query$/);
  if (!match) return false;
  if (req.method !== 'POST') throw new HttpError(405, '不支持的请求方法');
  await readJson(req);
  sendJson(res, 200, await queryNotificationDelivery(user, decodeURIComponent(match[1]), decodeURIComponent(match[2])));
  return true;
}
