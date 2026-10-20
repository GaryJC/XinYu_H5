import { useEffect,useRef,useState } from 'react';
import type { ProcurementPortal,ProcurementQuoteInput } from '../../../../shared/types';
import { supplierPortalApi } from './procurementApi';
export function useSupplierPortal() {
  const [token]=useState(()=>{
    const fresh=location.hash.slice(1);
    if(fresh){sessionStorage.setItem('procurement-invite',fresh);history.replaceState(null,'',location.pathname);return fresh;}
    return sessionStorage.getItem('procurement-invite')||'';
  });
  const [data,setData]=useState<ProcurementPortal>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const lastSubmission=useRef({fingerprint:'',requestId:''});
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{let cancelled=false;if(token)void supplierPortalApi.resume(token).then(next=>{if(!cancelled)setData(next);}).catch(()=>{});return()=>{cancelled=true;};},[token]);
  async function run(task:()=>Promise<void>) {setBusy(true);setError('');setNotice('');try{await task();}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'请求失败');}finally{if(mounted.current)setBusy(false);}}
  async function refresh() {const next=await supplierPortalApi.me();if(mounted.current)setData(next);}
  async function verify(phone:string,identity:string) {await run(async()=>{await supplierPortalApi.verify(token,phone,identity);await refresh();});}
  async function submit(input:ProcurementQuoteInput) {if(data?.kind!=='quote')return;await run(async()=>{const {requestId,...content}=input;const fingerprint=JSON.stringify({...content,invitationId:data.invitationId,termsVersion:data.termsVersion});if(lastSubmission.current.fingerprint!==fingerprint)lastSubmission.current={fingerprint,requestId};await supplierPortalApi.quote({...input,requestId:lastSubmission.current.requestId,invitationId:data.invitationId,termsVersion:data.termsVersion});await refresh();setNotice(input.declined?'已记录放弃报价，结束前可重新提交。':'报价已保存，以结束前最后一次提交为准。');});}
  async function feedback(value:string) {if(data?.kind!=='report')return;await run(async()=>{await supplierPortalApi.feedback(data.report.id,value);setNotice('反馈已保存，采购员可在后台查看。');});}
  return {data,error,busy,notice,token,verify,submit,feedback,refresh:()=>run(refresh),switchIdentity:()=>{setData(undefined);setError('');}};
}
