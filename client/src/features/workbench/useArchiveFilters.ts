import { useEffect, useState } from 'react';
import { Grid } from 'antd';
import type { ArchiveOptions, UserProfile } from '../../../../shared/types';
import { usePagedList } from '../../shared/hooks/usePagedList';
import { workOrderApi } from '../work-orders/api/workOrderApi';
import { archiveBounds, beijingDay, defaultArchiveFilters, type ArchiveFilters } from './archiveFilters';

export function useArchiveFilters(user?: UserProfile, overview = false, enabled = true) {
  const mobile = !Grid.useBreakpoint().md;
  const userId=user?.id;
  const [state,setState]=useState(()=>({userId,filters:defaultArchiveFilters()}));
  const [metadata,setMetadata]=useState<{userId?:string;options:ArchiveOptions}>();
  const [day,setDay]=useState(()=>beijingDay());
  useEffect(()=>{const timer=window.setInterval(()=>setDay(beijingDay()),30000);return()=>clearInterval(timer);},[]);
  if(state.userId!==userId)setState({userId,filters:defaultArchiveFilters()});
  const filters=state.userId===userId?state.filters:defaultArchiveFilters();
  const setFilters=(filters:ArchiveFilters)=>setState({userId,filters});
  const key=JSON.stringify({userId,filters,overview,day});
  const bounds=archiveBounds(filters);
  const list=usePagedList(key,page=>workOrderApi.page({page,pageSize:20,search:filters.search,baiyuanOnly:String(filters.baiyuanOnly),
    statuses:JSON.stringify(filters.statuses),advisors:JSON.stringify(filters.advisors),technicians:JSON.stringify(filters.technicians),sort:filters.sort,
    ...(bounds?{from:new Date(bounds[0]).toISOString(),to:new Date(bounds[1]).toISOString()}:{}),...(overview?{shopId:user?.shopId}:{})}),mobile,enabled&&Boolean(user),order=>order.id);
  useEffect(()=>{
    if(!user||!enabled)return;
    let active=true;
    void workOrderApi.archiveOptions().then(options=>{if(active)setMetadata({userId,options});}).catch(()=>{});
    return()=>{active=false;};
  },[userId,enabled,list.total]);
  const options=metadata && metadata.userId===userId?metadata.options:{statuses:[],advisors:[],technicians:[]};
  return {...list,mobile,filters,setFilters,filteredOrders:list.items,options,reset:()=>setFilters(defaultArchiveFilters())};
}
export type ArchiveFilterController = ReturnType<typeof useArchiveFilters>;
