import { createRequestId } from "../../shared/api/requestId";
import { useActionFeedback } from "../../shared/ui/useActionFeedback";
import {useCallback,useEffect,useRef,useState} from 'react';
import {request} from '../../shared/api/httpClient';
import type {PendingRepairCommand,PendingRepairList,DispatchPeople,DispatchTask,DispatchDetail} from '../../../../shared/types';
export function usePendingRepairs(orderId:string,onChanged?:()=>void,refreshVersion?:number) {
  const feedback = useActionFeedback();
 const [data,setData]=useState<PendingRepairList>({items:[],version:0});
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false);
 const [peopleLoading,setPeopleLoading]=useState(false);
 const [people,setPeople]=useState<DispatchPeople>();
 const [task,setTask]=useState<DispatchTask>();
 const pending=useRef<{key:string;body:PendingRepairCommand}|undefined>(undefined);
 const submitting=useRef(false);
 const loadSequence=useRef(0);
 const load=useCallback(async()=>{const sequence=++loadSequence.current;try{const value=await request<PendingRepairList>(`/api/work-orders/${encodeURIComponent(orderId)}/pending-repairs`);if(sequence===loadSequence.current){setData(value);setLoaded(true);}}catch(e){if(sequence===loadSequence.current)setError(String(e instanceof Error?e.message:e));}},[orderId]);
 useEffect(()=>{setLoaded(false);setData({items:[],version:0});void load();return()=>{loadSequence.current++;};},[load,refreshVersion]);
 async function loadPeople(){setPeopleLoading(true);setError('');setTask(undefined);try{const [people,detail]=await Promise.all([request<DispatchPeople>('/api/dispatch/people'),request<DispatchDetail>(`/api/dispatch/tasks/${encodeURIComponent(orderId)}`)]);setPeople(people);setTask(detail.task);const originalIds=[detail.task.technicianId,...(detail.task.technicianIds||[]),...detail.task.items.map(item=>item.responsibleId)];const defaultTechnicianId=originalIds.find(id=>id&&people.technicians.some(person=>person.id===id&&person.active));return {task:detail.task,defaultTechnicianId};}catch(e){setError(String(e instanceof Error?e.message:e));}finally{setPeopleLoading(false);}}

 async function act(input:Omit<PendingRepairCommand,'requestId'|'expectedVersion'>) {
  if(submitting.current)return false;
  submitting.current=true;
  setBusy(true);setError('');
  try{
   const key=JSON.stringify([orderId,input]),body=pending.current?.key===key?pending.current.body:{...input,expectedVersion:data.version,requestId:createRequestId()};
   pending.current={key,body};
   setData(await request<PendingRepairList>(`/api/work-orders/${encodeURIComponent(orderId)}/pending-repairs`,{method:'POST',body}));pending.current=undefined;feedback.success(({add:'待确认项目已添加',approve:'客户确认已记录',decline:'客户拒绝已记录',schedule:'派工成功','approve-and-schedule':'已确认并派工',cancel:'项目已取消','remind-inspector':'提醒已发送'})[input.action]);await load();onChanged?.();return true;}
  catch(e){feedback.error(e);setError(String(e instanceof Error?e.message:e));// Only definitive rejections discard the idempotency key. A gateway or
   // server error can arrive after the transaction has already committed.
   if(e instanceof Error&&'status' in e&&[400,401,403,404,409,422].includes(Number(e.status)))pending.current=undefined;await load();return false;}
  finally{submitting.current=false;setBusy(false);}
 }
 return {data,error,busy,loaded,peopleLoading,people,task,act,loadPeople};
}
