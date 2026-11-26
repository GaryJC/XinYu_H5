import { requireAnyRole } from '../domain/accessPolicy.mjs';
import { onsiteCategories, onsiteOrders } from '../domain/onsiteDashboard.mjs';
import { pagination } from '../domain/pagination.mjs';
import { HttpError } from '../http/HttpError.mjs';
import { readOnsiteData } from '../repositories/onsiteDashboardRepository.mjs';

export async function onsiteDashboard(actor, query = {}) {
  requireAnyRole(actor, ['manager']);
  if (!actor.active || !actor.shopId) throw new HttpError(403, '当前账号无法查看门店运营');
  if (query.category !== undefined && !onsiteCategories.includes(query.category)) throw new HttpError(400, '无效的现场运营类别');
  const { page, pageSize } = pagination(query);
  const now = new Date();
  const month = new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 7);
  const { orders, people, vehicle } = await readOnsiteData(actor.shopId, now, month);
  return { ...onsiteOrders(orders, people, now, query.category, page, pageSize), vehicle };
}
