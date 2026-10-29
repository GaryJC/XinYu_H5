import {useEffect} from 'react';
import {notification} from 'antd';
import {startVersionMonitor} from './versionMonitor';

export function AppUpdateNotice() {
  const [api,contextHolder]=notification.useNotification();
  useEffect(()=>{
    if(!import.meta.env.PROD)return;
    return startVersionMonitor({version:__APP_VERSION__,onUpdate:()=>api.info({
      key:'app-update',title:'系统已更新',
      description:'请先保存当前内容，再关闭本应用并重新进入，以使用最新版本。无需退出整个钉钉。',
      duration:0,placement:'top',role:'status',
      style:{width:'min(360px, calc(100vw - 32px))'}
    })});
  },[api]);
  return contextHolder;
}
