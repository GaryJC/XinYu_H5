import { useEffect, useRef, useState } from 'react';
import type { NotificationDelivery, NotificationSource } from '../../../../shared/types';
import { subscribeAuthSession } from '../../shared/api/httpClient';
import { notificationApi } from './notificationApi';

export function useNotificationRecords(source: NotificationSource, resourceId: string) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDelivery[]>([]);
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [loading, setLoading] = useState(false);
  const [queryingId, setQueryingId] = useState('');
  const current = useRef({ generation: 0, busy: false, alive: false, read: undefined as AbortController | undefined });
  useEffect(() => {
    const state = current.current;
    state.alive = true;
    function reset() {
      state.generation++; state.busy = false; state.read?.abort(); state.read = undefined;
      setOpen(false); setItems([]); setError(''); setRefreshError(''); setLoading(false); setQueryingId('');
    }
    reset();
    const unsubscribe = subscribeAuthSession(reset);
    return () => { state.alive = false; state.generation++; state.read?.abort(); unsubscribe(); };
  }, [source, resourceId]);

  async function load() {
    const state = current.current;
    if (state.busy) return;
    const generation = state.generation;
    state.busy = true; state.read = new AbortController(); setLoading(true); setError(''); setRefreshError('');
    try {
      const rows = await notificationApi.list(source, resourceId, state.read.signal);
      if (state.alive && generation === state.generation) setItems(rows);
    } catch (failure) {
      if (state.alive && generation === state.generation) setError(failure instanceof Error ? failure.message : '通知记录加载失败');
    } finally {
      if (state.alive && generation === state.generation) { state.busy = false; state.read = undefined; setLoading(false); }
    }
  }

  async function query(id: string) {
    const state = current.current;
    if (state.busy || !items.some(item => item.id === id && item.canQuery && ['accepted', 'unknown'].includes(item.status))) return;
    const generation = state.generation;
    state.busy = true; setQueryingId(id); setError(''); setRefreshError('');
    try {
      const result = await notificationApi.query(source, id);
      if (!state.alive || generation !== state.generation) return;
      // Preserve the confirmed response even if the following local record refresh fails.
      setItems(rows => rows.map(item => item.id === id ? { ...item, ...result, canQuery: false,
        queryUnavailableReason: ['sent', 'failed'].includes(result.status) ? undefined : '已查询，请稍后刷新记录再查询' } : item));
      try {
        const rows = await notificationApi.list(source, resourceId);
        if (state.alive && generation === state.generation) setItems(rows);
      } catch {
        if (state.alive && generation === state.generation) setRefreshError('查询结果已保留，记录刷新失败，请点击“刷新记录”');
      }
    } catch (failure) {
      if (state.alive && generation === state.generation) setError(failure instanceof Error ? failure.message : '查询发送结果失败');
    } finally {
      if (state.alive && generation === state.generation) { state.busy = false; setQueryingId(''); }
    }
  }

  function toggle(expanded: boolean) {
    setOpen(expanded);
    if (expanded) void load();
  }
  return { open, toggle, items, error, refreshError, loading, queryingId, busy: loading || Boolean(queryingId), load, query };
}
