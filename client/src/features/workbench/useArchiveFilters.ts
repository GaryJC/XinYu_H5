import { useEffect, useMemo, useState } from 'react';
import type { WorkOrder } from '../../../../shared/types';
import { workOrderDisplayStatus } from '../work-orders/domain/workOrderDomain';
import { archivePerson, archiveTechnicians, beijingDay, defaultArchiveFilters, filterArchiveOrders, type ArchiveFilters } from './archiveFilters';

export function useArchiveFilters(orders: WorkOrder[], userId?: string) {
  const [state, setState] = useState(() => ({ userId, filters: defaultArchiveFilters(), page: 1 }));
  const [day, setDay] = useState(() => beijingDay());
  useEffect(() => {
    const update = () => setDay(beijingDay());
    const timer = window.setInterval(update, 30000);
    window.addEventListener('focus', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); };
  }, []);
  // Reset immediately when identities change, including before effects run.
  if (state.userId !== userId) setState({ userId, filters: defaultArchiveFilters(), page: 1 });
  const filters = state.userId === userId ? state.filters : defaultArchiveFilters();
  const setFilters = (next: ArchiveFilters) => setState({ userId, filters: next, page: 1 });
  const filteredOrders = useMemo(() => filterArchiveOrders(orders, filters, workOrderDisplayStatus), [orders, filters, day]);
  const options = useMemo(() => {
    const unique = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'zh-CN')).map(value => ({ value, label: value }));
    return {
      statuses: unique(orders.map(workOrderDisplayStatus)),
      advisors: unique(['未分配', ...orders.map(order => archivePerson(order.advisor))]),
      technicians: unique(['未分配', ...orders.flatMap(order => archiveTechnicians(order.technician))])
    };
  }, [orders]);
  return { filters, setFilters, filteredOrders, options, page: Math.min(state.page, Math.max(1, Math.ceil(filteredOrders.length / 8))),
    setPage: (page: number) => setState(current => ({ ...current, page })),
    reset: () => setFilters(defaultArchiveFilters()) };
}
export type ArchiveFilterController = ReturnType<typeof useArchiveFilters>;
