import {useCallback, useEffect, useRef, useState} from 'react';
import {request} from '../../shared/api/httpClient';
import type {OperationsDashboard} from '../../../../shared/types';

export function useOperationsDashboard(refreshKey?:string,endpoint='/api/dashboard/operations',enabled=true) {
  const [data,setData] = useState<OperationsDashboard>();
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(false);
  const active = useRef<AbortController | undefined>(undefined);
  const refresh = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setError('');
    try {
      const result = await request<OperationsDashboard>(endpoint,{signal:controller.signal});
      if (!controller.signal.aborted) setData(result);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '看板加载失败');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  },[endpoint]);
  useEffect(() => {
    if (!enabled) {setLoading(false);return;}
    void refresh();
    return () => active.current?.abort();
  },[refresh,refreshKey,enabled]);
  return {data,error,loading,refresh};
}
