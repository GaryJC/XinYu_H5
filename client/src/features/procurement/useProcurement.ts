import { useActionFeedback } from "../../shared/ui/useActionFeedback";
import { useCallback,useEffect,useRef,useState } from 'react';
import type { ProcurementSupplier,ProcurementTender,ProcurementDetail,ProcurementLink,ProcurementAnalytics,ProcurementReportRecord,ProcurementAudit } from '../../../../shared/types';
import { procurementApi } from './procurementApi';
export function useProcurement() {
  const feedback = useActionFeedback();
  const [suppliers,setSuppliers]=useState<ProcurementSupplier[]>([]),[tenders,setTenders]=useState<ProcurementTender[]>([]);
  const [detail,setDetail]=useState<ProcurementDetail>(),[selectedId,setSelectedId]=useState<string>();
  const [links,setLinks]=useState<ProcurementLink[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(true),[refreshAt,setRefreshAt]=useState('');
  const [analysis,setAnalysis]=useState<ProcurementAnalytics>(),[reports,setReports]=useState<ProcurementReportRecord[]>([]);
  const [report,setReport]=useState<ProcurementReportRecord&{activity?:ProcurementAudit[]}>();
  const alive=useRef(true),selection=useRef<string|undefined>(undefined);
  const detailGeneration=useRef(0),listGeneration=useRef(0),pending=useRef(0),mutationPending=useRef(false);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const load=useCallback(async()=>{
    const generation=++listGeneration.current;
    const [s,t,r]=await Promise.all([procurementApi.suppliers(),procurementApi.tenders(),procurementApi.reports()]);
    if(!alive.current||generation!==listGeneration.current)return;setSuppliers(s);setTenders(t);setReports(r);setRefreshAt(new Date().toLocaleTimeString('zh-CN'));
  },[]);
  const openTender=useCallback(async(id:string)=>{
    const generation=++detailGeneration.current;
    selection.current=id;setSelectedId(id);setDetail(undefined);
    const d=await procurementApi.detail(id);if(alive.current&&selection.current===id&&generation===detailGeneration.current)setDetail(d);
  },[]);
  const run=useCallback(async<T,>(task:()=>Promise<T>,success?:string):Promise<T|undefined>=>{
    pending.current++;setBusy(true);setError('');try{const result=await task();if(success)feedback.success(success);return result;}catch(e){feedback.error(e);if(alive.current)setError(e instanceof Error?e.message:'操作失败');return undefined;}finally{pending.current--;if(alive.current)setBusy(pending.current>0);}
  },[feedback]);
  useEffect(()=>{
    void run(load);
    const params=new URLSearchParams(location.search),id=params.get('procurementTender'),reportId=params.get('procurementReport');
    if(id)void run(()=>openTender(id));if(reportId)void run(async()=>setReport(await procurementApi.report(reportId)));
  },[load,openTender,run]);
  useEffect(()=>{
    let cancelled=false,running=false;
    const timer=setInterval(async()=>{if(running||pending.current>0||document.hidden||selection.current!==selectedId)return;running=true;const generation=++detailGeneration.current,listVersion=++listGeneration.current;try{
      const [t,d]=await Promise.all([procurementApi.tenders(),selectedId?procurementApi.detail(selectedId):Promise.resolve(undefined)]);
      if(!cancelled&&alive.current&&pending.current===0&&listVersion===listGeneration.current){setTenders(t);if(d&&selection.current===selectedId&&generation===detailGeneration.current)setDetail(d);setRefreshAt(new Date().toLocaleTimeString('zh-CN'));}
    }catch(e){if(!cancelled)setError(e instanceof Error?e.message:'刷新失败');}finally{running=false;}},5000);
    return()=>{cancelled=true;clearInterval(timer);};
  },[selectedId]);
  async function action(body:Record<string,unknown>) {
    if(!selectedId||selection.current!==selectedId||mutationPending.current)return;
    mutationPending.current=true;
    const id=selectedId;
    detailGeneration.current++;
    return run(async()=>{
      const d=await procurementApi.action(id,body);
      if(alive.current&&selection.current===id){detailGeneration.current++;setDetail(d);if(d.link)setLinks([d.link]);}
      feedback.success('询价操作成功');
      await load();return d;
    }).finally(()=>{mutationPending.current=false;});
  }
  return {suppliers,tenders,detail,selectedId,links,setLinks,error,busy,refreshAt,analysis,setAnalysis,reports,report,setReport,
    run,load,openTender,action,closeDetail:()=>{detailGeneration.current++;selection.current=undefined;setSelectedId(undefined);setDetail(undefined);},
  };
}
export type ProcurementController=ReturnType<typeof useProcurement>;
