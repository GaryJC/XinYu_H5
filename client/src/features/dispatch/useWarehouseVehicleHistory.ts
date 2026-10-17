import {getAuthToken} from '../../shared/api/httpClient';
import {loadVehiclePartsHistory} from './vehiclePartsHistoryCache';
import {useEffect,useRef,useState} from 'react';
import type {VehiclePartsHistory,VehicleHistoricalPart,RunfengStockSearchResult} from '../../../../shared/types';
import {dispatchApi} from './dispatchApi';
export function useWarehouseVehicleHistory(orderId:string,initialFilter='') {
  const [history,setHistory]=useState<VehiclePartsHistory>(),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const [filter,setFilter]=useState(initialFilter),[selected,setSelected]=useState<VehicleHistoricalPart>(),[stock,setStock]=useState<RunfengStockSearchResult>(),[stockLoading,setStockLoading]=useState(false),[stockError,setStockError]=useState('');
  const generation=useRef(0);
  const session=getAuthToken();
  useEffect(()=>setFilter(initialFilter),[initialFilter,orderId]);
  useEffect(()=>{let active=true;setLoading(true);setError('');setHistory(undefined);setSelected(undefined);setStock(undefined);setStockError('');setStockLoading(false);generation.current++;
    void loadVehiclePartsHistory(JSON.stringify([session,orderId]),()=>dispatchApi.vehiclePartsHistory(orderId),revision>0).then(value=>{if(active)setHistory(value);}).catch(e=>{if(active)setError(e instanceof Error?e.message:'历史用料加载失败');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;generation.current++;};
  },[orderId,revision,session]);
  async function lookup(part:VehicleHistoricalPart) {
    if(!part.code)return;
    const current=++generation.current;setSelected(part);setStock(undefined);setStockError('');setStockLoading(true);
    try{const value=await dispatchApi.historicalPartStock(orderId,part.code);if(current===generation.current)setStock(value);}
    catch(e){if(current===generation.current)setStockError(e instanceof Error?e.message:'历史型号库存查询失败');}
    finally{if(current===generation.current)setStockLoading(false);}
  }
  // Filter only this vehicle's real material lines; do not search the global catalog by name.
  const normalize=(value:string)=>value.toLowerCase().replace(/滤清器|滤芯/g,'滤').replace(/[\s-]/g,'');
  const items=(history?.items||[]).filter(part=>!filter.trim()||filter.trim().split(/\s+/).every(word=>normalize([part.name,part.code,part.specification,part.manufacturer].join(' ')).includes(normalize(word))));
  return{history,loading,error,reload:()=>setRevision(v=>v+1),filter,setFilter,items,selected,stock,stockLoading,stockError,lookup};
}
