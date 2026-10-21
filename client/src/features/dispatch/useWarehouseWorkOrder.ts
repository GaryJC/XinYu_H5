import {useEffect,useState} from 'react';
import type {WorkOrder} from '../../../../shared/types';
import {workOrderApi} from '../work-orders/api/workOrderApi';

export function useWarehouseWorkOrder(orderId?:string) {
  const [order,setOrder]=useState<WorkOrder>(),[error,setError]=useState(''),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0);
  useEffect(()=>{
    let active=true;setOrder(undefined);setError('');setLoading(Boolean(orderId));
    if(orderId)void workOrderApi.get(orderId).then(value=>{if(active)setOrder(value);}).catch(e=>{if(active)setError(e instanceof Error?e.message:'委托单加载失败');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[orderId,revision]);
  return {order,error,loading,retry:()=>setRevision(value=>value+1)};
}
