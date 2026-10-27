import { useEffect, useRef, useState } from 'react';
import type { OrderOverview, OrderPhotoCategory, OrderPhotoExportDownload, OrderPhotoExportRequest } from '../../../../shared/types';
import { request } from '../../shared/api/httpClient';
import { isDingTalkMobile, savePrintFile } from '../../integrations/dingtalk/printFile';
export function useOrderOverview(id: string) {
  const [data,setData]=useState<OrderOverview>();
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let active=true;setLoading(true);setError('');setData(undefined);
    void request<OrderOverview>(`/api/work-orders/${encodeURIComponent(id)}/overview`).then(value=>{if(active)setData(value);})
      .catch(reason=>{if(active)setError(reason.message);}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[id,attempt]);
  return {data,error,loading,retry:()=>setAttempt(value=>value+1)};
}
export function useOrderPhotoExport(id:string) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [download,setDownload]=useState<OrderPhotoExportDownload>();
  const locked=useRef(false),active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  async function generate(categories:OrderPhotoCategory[]) {
    if(locked.current)return;locked.current=true;setBusy(true);setError('');setDownload(undefined);
    try {
      const body:OrderPhotoExportRequest={categories};
      const result=await request<OrderPhotoExportDownload>(`/api/work-orders/${encodeURIComponent(id)}/photo-document`,{method:'POST',body});
      if(!active.current)return;
      setDownload(result);
      const url=new URL(result.path,location.origin).href;
      if(isDingTalkMobile())await savePrintFile(url,result.fileName);
      else {const link=document.createElement('a');link.href=url;link.download=result.fileName;document.body.append(link);link.click();link.remove();}
    } catch(reason) {if(active.current)setError(reason instanceof Error?reason.message:'导出失败，请重试');}
    finally {locked.current=false;if(active.current)setBusy(false);}
  }
  return {busy,error,download,generate};
}
