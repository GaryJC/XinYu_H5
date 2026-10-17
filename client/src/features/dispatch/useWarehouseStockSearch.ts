import { useEffect,useRef,useState } from 'react';
import type { RunfengStockSearchResult,RunfengWarehouse } from '../../../../shared/types';
import { dispatchApi } from './dispatchApi';

export function useWarehouseStockSearch(orderId:string) {
  const [query,setQuery]=useState(''),[warehouseId,setWarehouseId]=useState<number>(),[inStockOnly,setInStockOnly]=useState(true);
  const [warehouses,setWarehouses]=useState<RunfengWarehouse[]>([]),[optionsError,setOptionsError]=useState(''),[optionsLoading,setOptionsLoading]=useState(false),[optionsRevision,setOptionsRevision]=useState(0);
  const [result,setResult]=useState<RunfengStockSearchResult>(),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const generation=useRef(0);
  useEffect(()=>()=>{generation.current++;},[orderId]);
  useEffect(()=>{let active=true;setOptionsLoading(true);setOptionsError('');
    void dispatchApi.stockWarehouses(orderId).then(value=>{if(active)setWarehouses(value.warehouses);}).catch(e=>{if(active)setOptionsError(e instanceof Error?e.message:'仓库列表加载失败');}).finally(()=>{if(active)setOptionsLoading(false);});
    return()=>{active=false;};
  },[orderId,optionsRevision]);
  function clearResults(){generation.current++;setResult(undefined);setError('');setLoading(false);}
  function changeWarehouse(value?:number){clearResults();setWarehouseId(value);}
  function changeInStock(value:boolean){clearResults();setInStockOnly(value);}
  async function search(value=query) {
    const term=value.trim();setQuery(value);setError('');
    if(!term||term.length>80){clearResults();setError('请输入 1 至 80 字的配件名称、货号或规格');return;}
    const current=++generation.current;setLoading(true);setResult(undefined);
    try{const next=await dispatchApi.searchStock(orderId,{query:term,warehouseId,inStockOnly});if(current===generation.current)setResult(next);}
    catch(e){if(current===generation.current)setError(e instanceof Error?e.message:'配件检索失败');}
    finally{if(current===generation.current)setLoading(false);}
  }
  return {query,setQuery,warehouseId,changeWarehouse,inStockOnly,changeInStock,warehouses,optionsError,optionsLoading,retryOptions:()=>setOptionsRevision(v=>v+1),result,error,loading,search};
}
