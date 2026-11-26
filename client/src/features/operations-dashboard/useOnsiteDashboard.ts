import {useEffect, useRef, useState} from 'react';
import type {OnsiteCategory, OnsiteDashboard} from '../../../../shared/types';
import {request} from '../../shared/api/httpClient';

export function useOnsiteDashboard(revision:number) {
  const [query,setQuery] = useState<{category?:OnsiteCategory; page:number}>({page:1});
  const [attempt,setAttempt] = useState(0);
  const [data,setData] = useState<OnsiteDashboard>();
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const lastCategory = useRef<OnsiteCategory | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({page:String(query.page),pageSize:'5'});
    const category = query.category ?? lastCategory.current;
    if (category) params.set('category',category);
    setLoading(true);
    setError('');
    queueMicrotask(async () => {
      if (controller.signal.aborted) return;
      try {
        const result = await request<OnsiteDashboard>(`/api/dashboard/onsite?${params}`,{signal:controller.signal});
        if (!controller.signal.aborted) {
          lastCategory.current = result.category;
          setData(result);
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '现场运营加载失败');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    });
    return () => controller.abort();
  },[query,attempt,revision]);

  return {data,loading,error,category:query.category ?? data?.category,
    selectCategory:(category:OnsiteCategory) => setQuery({category,page:1}),
    selectPage:(page:number) => setQuery({category:data?.category,page}),
    refresh:() => setAttempt(n => n+1)};
}
