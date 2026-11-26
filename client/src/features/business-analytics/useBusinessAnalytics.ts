import {useEffect, useState} from 'react';
import type {BusinessAnalytics} from '../../../../shared/types';
import {request} from '../../shared/api/httpClient';

type ReportState = {month: string; loading: boolean; data?: BusinessAnalytics; error?: string};

export function useBusinessAnalytics(month: string) {
  const [state, setState] = useState<ReportState>({month, loading:true});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState(previous => ({month, loading:true, data:previous.month === month ? previous.data : undefined}));
    queueMicrotask(async () => {
      if (controller.signal.aborted) return;
      try {
        const data = await request<BusinessAnalytics>(`/api/dashboard/analytics?${new URLSearchParams({month})}`, {signal:controller.signal});
        if (!controller.signal.aborted) setState({month, data, loading:false});
      } catch (error) {
        if (!controller.signal.aborted) setState(previous => ({...previous, loading:false, error:error instanceof Error ? error.message : '经营数据加载失败'}));
      }
    });
    return () => controller.abort();
  }, [month, attempt]);
  const current = state.month === month ? state : {month, loading:true};
  return {...current, refresh:() => setAttempt(value => value + 1)};
}
