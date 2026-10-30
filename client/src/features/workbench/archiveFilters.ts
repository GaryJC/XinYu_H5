import {repairCategory} from '../../../../shared/repairCompletion.mjs';
import type { WorkOrder } from '../../../../shared/types';

import type { ArchiveFilters } from '../../../../shared/types';
export type { ArchiveFilters } from '../../../../shared/types';
export const defaultArchiveFilters = (): ArchiveFilters => ({ search: '', baiyuanOnly: false, range: 'all', from: '', to: '', statuses: [], advisors: [], technicians: [], sort: 'updated-desc' });
const DAY = 86400000;
const OFFSET = 8 * 3600000;
export const beijingDay = (time = Date.now()) => new Date(time + OFFSET).toISOString().slice(0, 10);

// Explicit parsing keeps legacy display strings independent of browser locale/timezone.
export function archiveTimestamp(value?: string): number {
  if (!value) return NaN;
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return Date.parse(value);
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(value.trim());
  if (!match) return NaN;
  const [, y, m, d, h = '0', minute = '0', second = '0'] = match;
  const date = new Date(Date.UTC(+y, +m - 1, +d, +h, +minute, +second));
  if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +m - 1 || date.getUTCDate() !== +d || +h > 23 || +minute > 59 || +second > 59) return NaN;
  return date.getTime() - OFFSET;
}
export function archiveDateError(filters: ArchiveFilters): string {
  if (filters.range !== 'custom') return '';
  if (!filters.from || !filters.to) return '请选择开始日期和结束日期（可选择同一天）';
  if (!Number.isFinite(archiveTimestamp(filters.from)) || !Number.isFinite(archiveTimestamp(filters.to))) return '请选择有效日期';
  return filters.from > filters.to ? '开始日期不能晚于结束日期' : '';
}
export function archiveBounds(filters: ArchiveFilters, now = Date.now()): [number, number] | undefined {
  const today = archiveTimestamp(beijingDay(now));
  switch (filters.range) {
    case 'all': return undefined;
    case 'today': return [today, today + DAY];
    case 'yesterday': return [today - DAY, today];
    case 'week': return [today - 6 * DAY, today + DAY];
    case 'custom': return [archiveTimestamp(filters.from), archiveTimestamp(filters.to) + DAY];
  }
}
export const archivePerson = (name?: string) => !name?.trim() || ['待派工', '未分配'].includes(name.trim()) ? '未分配' : name.trim();
export const archiveTechnicians = (names?: string) => [...new Set((names || '').split(/[、,，;；]/).map(archivePerson))];
export function orderTimestamp(order: WorkOrder, field: 'created' | 'updated') {
  return archiveTimestamp(field === 'created' ? order.createdAtIso || order.createdAt : order.updatedAtIso || order.updatedAt);
}
export function filterArchiveOrders(orders: WorkOrder[], filters: ArchiveFilters, displayStatus: (order: WorkOrder) => string, now = Date.now()) {
  const bounds = archiveBounds(filters, now);
  const term = filters.search.trim().toLowerCase();
  const matches = (values: string[], value: string) => !values.length || values.includes(value);
  const [field, direction] = filters.sort.split('-') as ['created' | 'updated', 'asc' | 'desc'];
  return orders.filter(order => {
    const created = orderTimestamp(order, 'created');
    return (!bounds || (created >= bounds[0] && created < bounds[1]))
      && (!term || [order.id, order.dispatchNo, order.vehicle.plate, order.vehicle.vin, order.vehicle.model, order.customer.name].some(value => value?.toLowerCase().includes(term)))
      && (!filters.baiyuanOnly || order.isBaiyuanOrder === true)
      && matches(filters.statuses.map(repairCategory), repairCategory(displayStatus(order)))
      && matches(filters.advisors, archivePerson(order.advisor))
      && (!filters.technicians.length || archiveTechnicians(order.technician).some(name => filters.technicians.includes(name))); 
  }).sort((a, b) => {
    const x = orderTimestamp(a, field), y = orderTimestamp(b, field);
    if (Number.isFinite(x) !== Number.isFinite(y)) return Number.isFinite(x) ? -1 : 1;
    if (Number.isFinite(x) && x !== y) return (x - y) * (direction === 'asc' ? 1 : -1);
    return a.id.localeCompare(b.id);
  });
}
export function archiveTimeLabel(order: WorkOrder, field: 'created' | 'updated') {
  const time = orderTimestamp(order, field);
  return Number.isFinite(time) ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(time) : '-';
}
