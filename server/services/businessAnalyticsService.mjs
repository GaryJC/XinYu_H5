import { requireAnyRole } from '../domain/accessPolicy.mjs';
import { analyticsOrderPage, analyticsPeriod, buildBusinessAnalytics } from '../domain/businessAnalytics.mjs';
import { pagination } from '../domain/pagination.mjs';
import { HttpError } from '../http/HttpError.mjs';
import { readBusinessAnalyticsOrders } from '../repositories/businessAnalyticsRepository.mjs';

function requireShopManager(actor) {
  requireAnyRole(actor, ['manager']);
  if (actor.active === false || !actor.shopId) throw new HttpError(403, '当前账号无法查看门店经营统计');
}

export async function businessAnalytics(actor, period = 30) {
  requireShopManager(actor);
  const options = typeof period === 'number' ? { days: period } : period;
  const now = new Date();
  analyticsPeriod(options, now);
  return buildBusinessAnalytics(await readBusinessAnalyticsOrders(actor), { ...options, now });
}

export async function businessAnalyticsOrders(actor, query = {}) {
  requireShopManager(actor);
  if (!query.month || !['orders', 'completed'].includes(query.metric)) {
    throw new HttpError(400, '请选择月份和工单指标');
  }
  const now = new Date();
  const period = analyticsPeriod({ month: query.month }, now);
  const { page, pageSize } = pagination(query);
  const records = period.start === period.end ? []
    : await readBusinessAnalyticsOrders(actor, undefined, { metric: query.metric, ...period });
  return analyticsOrderPage(records, { metric: query.metric, page, pageSize }, period, now);
}
