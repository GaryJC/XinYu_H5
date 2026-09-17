import { useCallback,useEffect,useRef,useState } from 'react';
import type { DingTalkMappings,DingTalkRoleMapping,DingTalkDepartmentMapping,UserProfile } from '../../../../shared/types';
import { accessApi } from './accessApi';
export function useAccessSettings(initialUsers:UserProfile[]) {
  const [users,setUsers]=useState(initialUsers),[mappings,setMappings]=useState<DingTalkMappings>({roleMappings:[],departmentMappings:[]});
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const generation=useRef(0),busy=useRef(false);
  const refresh=useCallback(async()=>{
    const current=++generation.current;setLoading(true);setError('');
    try {const [nextUsers,nextMappings]=await Promise.all([accessApi.users(),accessApi.mappings()]);if(current===generation.current){setUsers(nextUsers);setMappings(nextMappings);setReady(true);}}
    catch(e){if(current===generation.current){setReady(false);setError(e instanceof Error?e.message:'读取权限设置失败');}}
    finally{if(current===generation.current)setLoading(false);}
  },[]);
  useEffect(()=>{void refresh();return()=>{generation.current++;};},[refresh]);
  async function save(kind:'role'|'department',value:DingTalkRoleMapping|DingTalkDepartmentMapping):Promise<string|undefined>{
    if(busy.current)return '正在保存，请稍候';busy.current=true;setSaving(true);setNotice('');
    try{if(kind==='role')await accessApi.saveRole(value as DingTalkRoleMapping);else await accessApi.saveDepartment(value as DingTalkDepartmentMapping);
      setNotice('规则已保存。相关员工下次钉钉免登时重新计算权限；已经打开的页面不会立即更新。');await refresh();return undefined;
    }catch(e){return e instanceof Error?e.message:'保存失败，请重试';}finally{busy.current=false;setSaving(false);}
  }
  return {users,mappings,loading,saving,ready,error,notice,setNotice,refresh,save};
}
export type AccessSettingsController=ReturnType<typeof useAccessSettings>;
