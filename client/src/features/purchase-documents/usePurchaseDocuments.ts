import { useEffect,useRef,useState } from 'react';
import { request } from '../../shared/api/httpClient';
import type { PurchaseDocumentRules,PurchaseDocumentFile,PurchaseDocumentPreview } from '../../../../shared/types';
const root='/api/purchase-documents';
export function usePurchaseDocuments(){
 const [rules,setRules]=useState<PurchaseDocumentRules>();
 const [templates,setTemplates]=useState<string[]>([]);
 const [files,setFiles]=useState<PurchaseDocumentFile[]>([]);
 const [preview,setPreview]=useState<PurchaseDocumentPreview>();
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [download,setDownload]=useState('');
 const abort=useRef<AbortController|null>(null);
 useEffect(()=>{const controller=new AbortController();void request<{defaults:PurchaseDocumentRules;templates:string[]}>(`${root}/config`,{signal:controller.signal}).then(r=>{setRules(r.defaults);setTemplates(r.templates);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>{controller.abort();abort.current?.abort();};},[]);
 useEffect(()=>()=>{if(download)URL.revokeObjectURL(download);},[download]);
 function updateRules(next:PurchaseDocumentRules){setRules(next);setPreview(undefined);setDownload('');setError('');}
 async function chooseFiles(selected:File[]){
  setPreview(undefined);setDownload('');setFiles([]);setError('');
  if(!selected.length)return;
  if(selected.length>20||selected.reduce((n,f)=>n+f.size,0)>8*1024*1024){setError('最多20个文件，合计不超过8MB');return;}
  setBusy(true);
  try{const next:PurchaseDocumentFile[]=[];for(const f of selected){
   if(!/\.(xlsx?|zip)$/i.test(f.name))throw Error('仅支持Excel或ZIP');
   const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('读取文件失败'));reader.readAsDataURL(f);});
   next.push({name:f.name,base64});
  }setFiles(next);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function run(action:'preview'|'generate'){
  if(!rules||!files.length||busy)return;
  setError('');setBusy(true);abort.current=new AbortController();
  try{
   const options={method:'POST' as const,body:{files,rules},timeoutMs:110000,signal:abort.current.signal};
   if(action==='preview'){setPreview(undefined);setDownload('');setPreview(await request<PurchaseDocumentPreview>(`${root}/preview`,options));}
   else{const output=await request<{base64:string;name:string}>(`${root}/generate`,options);const bytes=Uint8Array.from(atob(output.base64),c=>c.charCodeAt(0));setDownload(URL.createObjectURL(new Blob([bytes],{type:'application/zip'})));}
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return {rules,templates,files,preview,busy,error,download,updateRules,chooseFiles,run};
}
