import {useCallback,useEffect,useRef,useState} from 'react';
import {request} from '../../shared/api/httpClient';
import type {PendingRepairCommand,PendingRepairList,DispatchPeople,DispatchTask,DispatchDetail} from '../../../../shared/types';
export function usePendingRepairs(orderId:string,onChanged?:()=>void,refreshVersion?:number) {
 const [data,setData]=useState<PendingRepairList>({items:[],version:0});
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false);
 const [people,setPeople]=useState<DispatchPeople>();
 const [task,setTask]=useState<DispatchTask>();
 const pending=useRef<{key:string;body:PendingRepairCommand}|undefined>(undefined);
 const loadSequence=useRef(0);
 const load=useCallback(async()=>{const sequence=++loadSequence.current;try{const value=await request<PendingRepairList>(`/api/work-orders/${encodeURIComponent(orderId)}/pending-repairs`);if(sequence===loadSequence.current){setData(value);setLoaded(true);}}catch(e){if(sequence===loadSequence.current)setError(String(e instanceof Error?e.message:e));}},[orderId]);
 useEffect(()=>{setLoaded(false);setData({items:[],version:0});void load();return()=>{loadSequence.current++;};},[load,refreshVersion]);
 async function loadPeople(){setError('');setTask(undefined);try{const [people,detail]=await Promise.all([request<DispatchPeople>('/api/dispatch/people'),request<DispatchDetail>(`/api/dispatch/tasks/${encodeURIComponent(orderId)}`)]);setPeople(people);setTask(detail.task);const originalIds=[detail.task.technicianId,...(detail.task.technicianIds||[]),...detail.task.items.map(item=>item.responsibleId)];const defaultTechnicianId=originalIds.find(id=>id&&people.technicians.some(person=>person.id===id&&person.active));return {task:detail.task,defaultTechnicianId};}catch(e){setError(String(e instanceof Error?e.message:e));}}

 async function act(input:Omit<PendingRepairCommand,'requestId'|'expectedVersion'>) {
  if(busy)return false;
  const key=JSON.stringify(input),body=pending.current?.key===key?pending.current.body:{...input,expectedVersion:data.version,requestId:crypto.randomUUID()};
  pending.current={key,body};setBusy(true);setError('');
  try{setData(await request<PendingRepairList>(`/api/work-orders/${encodeURIComponent(orderId)}/pending-repairs`,{method:'POST',body}));pending.current=undefined;await load();onChanged?.();return true;}
  catch(e){setError(String(e instanceof Error?e.message:e));if(e instanceof Error&&'status' in e)pending.current=undefined;await load();return false;}
  finally{setBusy(false);}
 }
 return {data,error,busy,loaded,people,task,act,loadPeople};
}
