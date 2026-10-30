import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageResult } from '../../../../shared/types';

/** Each request is bounded. Mobile appends pages; desktop replaces the current page. */
export function usePagedList<T>(key: string, load: (page: number) => Promise<PageResult<T>>, mobile: boolean, enabled = true, getKey?: (item:T)=>string) {
  const [position, setPosition] = useState({key, mobile, page: 1});
  const [data, setData] = useState<{key: string; mobile: boolean; counts?:Record<string,number>; pages: Map<number,T[]>; total: number; page: number}>({key, mobile, pages: new Map(), total: 0, page: 1});
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [attempt,setAttempt]=useState(0);
  const generation = useRef(0), loader = useRef(load);
  loader.current = load;
  if(position.key!==key||position.mobile!==mobile)setPosition({key,mobile,page:1});
  const page = position.key === key && position.mobile === mobile ? position.page : 1;
  const current = data.key === key && data.mobile === mobile;
  const pages = current ? data.pages : new Map<number,T[]>();
  const refresh = useCallback(async () => {
    const revision = ++generation.current;
    if (!enabled) { setLoading(false); return; }
    setLoading(true); setError('');
    try {
      // Refresh already loaded mobile pages without losing the user's scroll position.
      const numbers = mobile ? Array.from({length:page},(_,index)=>index+1) : [page];
      const results: PageResult<T>[] = [];
      for (const number of numbers) {
        results.push(await loader.current(number));
        if (revision !== generation.current) return;
      }
      const last = results[results.length-1];
      setData({key,mobile,counts:last.counts,pages:new Map(results.map(result=>[result.page,result.items])),total:last.total,page:last.page});
      if(last.page!==page)setPosition({key,mobile,page:last.page});
    } catch (e) { if(revision===generation.current)setError(e instanceof Error?e.message:'列表加载失败，请重试'); }
    finally { if(revision===generation.current)setLoading(false); }
  },[key,mobile,page,enabled]);
  useEffect(()=>{
    const revision=++generation.current;
    if(!enabled){setLoading(false);return;}
    setLoading(true);setError('');
    // Debounce typing, and cancel stale filter/page responses.
    const timer=window.setTimeout(()=>{
      void loader.current(page).then(result=>{
        if(revision!==generation.current)return;
        setData(previous=>({key,mobile,counts:result.counts,total:result.total,page:result.page,
          pages:new Map([...(mobile&&previous.key===key&&previous.mobile===mobile&&result.page>1?[...previous.pages].filter(([number])=>number<=result.page):[]),[result.page,result.items]])}));
        if(result.page!==page)setPosition({key,mobile,page:result.page});
      }).catch(e=>{if(revision===generation.current)setError(e instanceof Error?e.message:'列表加载失败，请重试');})
        .finally(()=>{if(revision===generation.current)setLoading(false);});
    },200);
    return()=>{window.clearTimeout(timer);generation.current++;};
  },[key,mobile,page,enabled,attempt]);
  const rawItems = mobile ? [...pages.entries()].sort(([a],[b])=>a-b).flatMap(([,items])=>items) : pages.get(page)||[];
  const items = getKey ? [...new Map(rawItems.map(item=>[getKey(item),item])).values()] : rawItems;
  return {items,counts:current?data.counts:undefined,total:current?data.total:0,page:current?data.page:page,pageSize:20,loading:enabled&&(loading||!current&&!error),error,refresh,
    setPage:(next:number)=>{setPosition({key,mobile,page:next});setAttempt(n=>n+1);},
    loadMore:()=>{if(!loading){setPosition({key,mobile,page:current?data.page+1:1});setAttempt(n=>n+1);}},
    setItems:(update:T[]|((items:T[])=>T[]))=>setData(previous=>({...previous,pages:new Map([...previous.pages].map(([number,items])=>[number,typeof update==='function'?update(items):update]))}))};
}
