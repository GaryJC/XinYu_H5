import {useEffect,useState,useRef} from 'react';
import type {NotificationUsage} from '../../../../shared/types';
import {request,subscribeAuthSession} from '../../shared/api/httpClient';
export function useNotificationUsage(){
 const [open,setOpen]=useState(false),[date,setDate]=useState(()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10)),[page,setPage]=useState(1),[revision,setRevision]=useState(0);
 const active=useRef<AbortController|undefined>(undefined);
 const [data,setData]=useState<NotificationUsage>(),[loading,setLoading]=useState(false),[error,setError]=useState('');
 useEffect(()=>subscribeAuthSession(()=>{active.current?.abort();setOpen(false);setData(undefined);setError('');}),[]);
 useEffect(()=>{setData(undefined);setError('');if(!open){setLoading(false);return;}
  const controller=new AbortController();active.current=controller;setLoading(true);
  request<NotificationUsage>(`/api/notifications/usage?${new URLSearchParams({date,page:String(page)})}`,{signal:controller.signal})
   .then(value=>{if(!controller.signal.aborted)setData(value);}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'读取失败');})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[open,date,page,revision]);
 return {open,setOpen,date,setDate:(value:string)=>{setDate(value);setPage(1);},page,setPage,data,loading,error,refresh:()=>setRevision(n=>n+1)};
}
