import {useCallback,useEffect,useRef,useState} from 'react';
import type {BusinessAnalytics} from '../../../../shared/types';
import {request} from '../../shared/api/httpClient';
export function useBusinessAnalytics(days:number){
  const [data,setData]=useState<BusinessAnalytics>();
  const [loading,setLoading]=useState(true),[error,setError]=useState('');
  const sequence=useRef(0);
  const refresh=useCallback(async()=>{
    const id=++sequence.current;setLoading(true);setError('');setData(undefined);
    try{const result=await request<BusinessAnalytics>(`/api/dashboard/analytics?days=${days}`);if(id===sequence.current)setData(result);}
    catch(e){if(id===sequence.current)setError(e instanceof Error?e.message:'经营数据加载失败');}
    finally{if(id===sequence.current)setLoading(false);}
  },[days]);
  useEffect(()=>{void refresh();return()=>{sequence.current++;};},[refresh]);
  return {data,loading,error,refresh};
}
