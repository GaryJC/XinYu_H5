import { createRequestId } from "../../shared/api/requestId";
import { useCallback,useEffect,useRef,useState } from 'react';
import type { DispatchActionRequest,DispatchDetail,DispatchPeople,DispatchTask,TechnicianSummary,UserProfile } from '../../../../shared/types';
import { dispatchApi,type DispatchFilters } from './dispatchApi';
export type ActionInput=Omit<DispatchActionRequest,'expectedVersion'|'requestId'>;
export function useDispatchController(user:UserProfile,view:string,initialOrderId?:string) {
  const manager=['manager','advisor'].includes(user.role);
  const [filters,setFilters]=useState<DispatchFilters>({stage:view==='检验任务'?'待检验':undefined});
  const [tasks,setTasks]=useState<DispatchTask[]>([]);
  const [people,setPeople]=useState<DispatchPeople>({technicians:[],inspectors:[]});
  const [summaries,setSummaries]=useState<TechnicianSummary[]>([]);
  const [selectedId,setSelectedId]=useState<string|undefined>(()=>initialOrderId || new URLSearchParams(location.search).get('dispatchOrder') || undefined);
  const [detail,setDetail]=useState<DispatchDetail>();
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [updatedAt,setUpdatedAt]=useState('');
  const generation=useRef(0), detailGeneration=useRef(0), actionBusy=useRef(false);
  const pending=useRef<{key:string;body:DispatchActionRequest} | undefined>(undefined);
  const refresh=useCallback(async()=> {
    const current=++generation.current; setLoading(true);
    const results=await Promise.allSettled([dispatchApi.tasks(filters),dispatchApi.people(),manager?dispatchApi.summaries(filters):Promise.resolve([])]);
    if(current!==generation.current) return;
    if(results[0].status==='fulfilled') setTasks(results[0].value); else setTasks([]);
    if(results[1].status==='fulfilled') setPeople(results[1].value); else setPeople({technicians:[],inspectors:[]});
    if(results[2].status==='fulfilled') setSummaries(results[2].value); else setSummaries([]);
    const failed=results.find(r=>r.status==='rejected');
    if(failed?.status==='rejected') setError(failed.reason instanceof Error?failed.reason.message:'数据加载失败');
    else setUpdatedAt(new Date().toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai'}));
    setLoading(false);
  },[filters,manager]);
  const refreshDetail=useCallback(async()=> {
    const current=++detailGeneration.current;
    if(!selectedId) return;
    try {const next=await dispatchApi.detail(selectedId);if(current===detailGeneration.current) setDetail(next);}
    catch(e) {if(current===detailGeneration.current){setDetail(undefined);setError(e instanceof Error?e.message:'任务加载失败');}}
  },[selectedId]);
  useEffect(()=>{void refresh();return()=>{generation.current++;};},[refresh]);
  useEffect(()=>{if(selectedId) setDetail(undefined);void refreshDetail();return()=>{detailGeneration.current++;};},[refreshDetail]);
  useEffect(()=> {
    const update=()=>{if(document.visibilityState==='visible' && !actionBusy.current){void refresh();void refreshDetail();}};
    const timer=window.setInterval(update,30000);
    document.addEventListener('visibilitychange',update);window.addEventListener('focus',update);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',update);window.removeEventListener('focus',update);};
  },[refresh,refreshDetail]);
  function select(id?:string) {
    pending.current=undefined;setSelectedId(id);setError('');
    const url=new URL(location.href);if(id) url.searchParams.set('dispatchOrder',id);else url.searchParams.delete('dispatchOrder');
    history.replaceState(null,'',url);
  }
  async function act(input:ActionInput):Promise<boolean> {
    if(!detail || actionBusy.current) return false;
    actionBusy.current=true;setBusy(true);setError('');
    const id=detail.task.orderId,key=JSON.stringify({id,input});
    const body=pending.current?.key===key?pending.current.body:{...input,expectedVersion:detail.task.version,requestId:createRequestId()};
    pending.current={key,body};
    try {await dispatchApi.action(id,body);pending.current=undefined;await Promise.all([refresh(),refreshDetail()]);return true;}
    catch(e) {
      setError(e instanceof Error?e.message:'操作失败');
      // A definite HTTP failure may be corrected; an ambiguous network failure retains the idempotency key.
      if(e instanceof Error && 'status' in e) pending.current=undefined;
      await refreshDetail();return false;
    } finally {actionBusy.current=false;setBusy(false);}
  }
  return {manager,filters,setFilters,tasks,people,summaries,selectedId,detail,error,setError,loading,busy,updatedAt,refresh,select,act};
}
export type DispatchController=ReturnType<typeof useDispatchController>;
