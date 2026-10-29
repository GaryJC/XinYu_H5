import type { AppVersionResponse } from '../../../../shared/types';

export function startVersionMonitor({version,onUpdate,fetchVersion=fetch,doc=document,win=window}: {
  version:string;onUpdate:(version:string)=>void;fetchVersion?:typeof fetch;doc?:Document;win?:Window;
}) {
  let stopped=false, checking=false, lastCheck=-Infinity;
  let request:AbortController|undefined;
  const announced=new Set<string>();
  async function check() {
    if(stopped||checking||doc.visibilityState==='hidden'||Date.now()-lastCheck<15_000)return;
    checking=true;lastCheck=Date.now();
    const abort=new AbortController();request=abort;
    const timeout=win.setTimeout(()=>abort.abort(),10_000);
    try {
      const response=await fetchVersion('/api/app-version',{cache:'no-store',signal:abort.signal});
      if(!response.ok)return;
      const body:AppVersionResponse=await response.json();
      const next=body?.version;
      if(stopped||typeof next!=='string'||!next.trim()||next.length>128||next===version||announced.has(next))return;
      const key=`app-update-notified:${next}`;
      try {if(win.sessionStorage.getItem(key))return;} catch { /* WebView may deny storage. */ }
      announced.add(next);
      onUpdate(next);
      try {win.sessionStorage.setItem(key,'1');} catch { /* In-memory deduplication remains active. */ }
    } catch { /* Network failures must never interrupt the active form. */ }
    finally {win.clearTimeout(timeout);checking=false;}
  }
  const wake=()=>{void check();};
  doc.addEventListener('visibilitychange',wake);
  win.addEventListener('focus',wake);
  win.addEventListener('pageshow',wake);
  const interval=win.setInterval(wake,180_000);
  wake();
  return ()=>{
    stopped=true;request?.abort();win.clearInterval(interval);
    doc.removeEventListener('visibilitychange',wake);
    win.removeEventListener('focus',wake);
    win.removeEventListener('pageshow',wake);
  };
}
