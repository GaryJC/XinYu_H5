import { useCallback,useEffect,useRef,useState } from 'react';
import type { UserProfile } from '../../../../shared/types';
import { accessApi } from './accessApi';
export function useAccessSettings(initialUsers:UserProfile[]) {
  const [users,setUsers]=useState(initialUsers);
  const [loading,setLoading]=useState(true),[error,setError]=useState('');
  const generation=useRef(0);
  const refresh=useCallback(async()=>{
    const current=++generation.current;setLoading(true);setError('');
    try {const nextUsers=await accessApi.users();if(current===generation.current){setUsers(nextUsers);}}
    catch(e){if(current===generation.current){setError(e instanceof Error?e.message:'读取权限设置失败');}}
    finally{if(current===generation.current)setLoading(false);}
  },[]);
  useEffect(()=>{void refresh();return()=>{generation.current++;};},[refresh]);
  return {users,loading,error,refresh};
}
