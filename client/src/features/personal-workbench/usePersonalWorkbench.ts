import {useCallback,useEffect,useRef,useState} from 'react';
import {request} from '../../shared/api/httpClient';
import type {PersonalWorkbench,PersonalInboxPage,PersonalMessage} from '../../../../shared/types';
export function usePersonalWorkbench(userId?:string) {
 const [owner,setOwner]=useState(userId);
 const [data,setData]=useState<PersonalWorkbench>();
 const [error,setError]=useState('');
 const [open,setOpen]=useState(false);
 const [unreadOnly,setUnreadOnly]=useState(true);
 const [messages,setMessages]=useState<PersonalMessage[]>([]);
 const [cursor,setCursor]=useState<string|null>(null);
 const [loading,setLoading]=useState(false);
 const [messageError,setMessageError]=useState('');
 const [revision,setRevision]=useState(0);
 const abort=useRef<AbortController|undefined>(undefined);
 const refresh=useCallback(()=>setRevision(v=>v+1),[]);
 useEffect(()=>{setOwner(userId);setData(undefined);setError('');setMessages([]);setOpen(false);setUnreadOnly(true);setMessageError('');},[userId]);
 useEffect(()=>{
  if(!userId)return;
  let active=true,busy=false;
  const controller=new AbortController();
  const load=async()=>{
   if(busy||document.visibilityState!=='visible')return;
   busy=true;
   try{const next=await request<PersonalWorkbench>(`/api/personal-workbench?todos=${open}`,{signal:controller.signal});if(active){setData(next);setError('');}}
   catch(e){if(active)setError(e instanceof Error?e.message:'工作台更新失败');}
   finally{busy=false;}
  };
  void load();const timer=window.setInterval(()=>void load(),30_000);
  document.addEventListener('visibilitychange',load);
  window.addEventListener('focus',load);
  return()=>{active=false;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',load);window.removeEventListener('focus',load);};
 },[userId,revision,open]);
 // A new message/read change refreshes only an open inbox, not business pages.
 useEffect(()=>{
  if(!userId||!open)return;
  const controller=new AbortController();abort.current=controller;
  let active=true;setLoading(true);setMessageError('');
  void request<PersonalInboxPage>(`/api/inbox?unread=${unreadOnly}`,{signal:controller.signal}).then(page=>{if(active){setMessages(page.items);setCursor(page.nextCursor);}}).catch(e=>{if(active)setMessageError(e.message);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;controller.abort();};
 },[userId,open,unreadOnly,data?.latestId,data?.unread,revision]);
 const more=async()=>{
  if(!cursor||loading)return;setLoading(true);
  const controller=abort.current;
  try{const page=await request<PersonalInboxPage>(`/api/inbox?unread=${unreadOnly}&before=${cursor}`,{signal:controller?.signal});if(!controller?.signal.aborted){setMessages(old=>[...old,...page.items.filter(item=>!old.some(existing=>existing.id===item.id))]);setCursor(page.nextCursor);}}
  catch(e){if(!controller?.signal.aborted)setMessageError(e instanceof Error?e.message:'消息加载失败');}
  finally{if(!controller?.signal.aborted)setLoading(false);}
 };
 const markRead=async(id?:string)=>{
  const controller=abort.current;
  try{await request('/api/inbox/read',{method:'POST',body:id?{id}:{through:data?.latestId||'0'},signal:controller?.signal});if(!controller?.signal.aborted){setMessageError('');refresh();}return true;}
  catch(e){if(!controller?.signal.aborted)setMessageError(e instanceof Error?e.message:'已读状态保存失败');return false;}
 };
 return {data:owner===userId?data:undefined,error:owner===userId?error:'',refresh,open,setOpen,unreadOnly,setUnreadOnly,messages:owner===userId?messages:[],cursor,loading,messageError:owner===userId?messageError:'',more,markRead};
}
