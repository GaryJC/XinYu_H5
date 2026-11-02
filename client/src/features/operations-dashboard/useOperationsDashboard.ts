import {useCallback,useEffect,useRef,useState} from 'react';
import {request} from '../../shared/api/httpClient';
import type {OperationsDashboard} from '../../../../shared/types';
export function useOperationsDashboard(refreshKey?:string,endpoint='/api/dashboard/operations',enabled=true){
 const [data,setData]=useState<OperationsDashboard>();const [error,setError]=useState('');const [loading,setLoading]=useState(false);const sequence=useRef(0);
 const refresh=useCallback(async()=>{const id=++sequence.current;setLoading(true);setError('');try{const result=await request<OperationsDashboard>(endpoint);if(id===sequence.current)setData(result);}catch(e){if(id===sequence.current)setError(e instanceof Error?e.message:'看板加载失败');}finally{if(id===sequence.current)setLoading(false);}},[endpoint]);
 useEffect(()=>{if(!enabled)return;void refresh();return()=>{sequence.current++;};},[refresh,refreshKey,enabled]);
 return {data,error,loading,refresh};
}
