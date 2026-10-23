import { useCallback,useEffect,useRef,useState } from 'react';
import type { ProcurementSupplier,ProcurementTender,ProcurementDetail,ProcurementLink,ProcurementAnalytics,ProcurementReportRecord,ProcurementAudit } from '../../../../shared/types';
import { procurementApi } from './procurementApi';
export function useProcurement() {
  const [suppliers,setSuppliers]=useState<ProcurementSupplier[]>([]),[tenders,setTenders]=useState<ProcurementTender[]>([]);
  const [detail,setDetail]=useState<ProcurementDetail>(),[selectedId,setSelectedId]=useState<string>();
  const [links,setLinks]=useState<ProcurementLink[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[refreshAt,setRefreshAt]=useState('');
  const [analysis,setAnalysis]=useState<ProcurementAnalytics>(),[reports,setReports]=useState<ProcurementReportRecord[]>([]);
  const [report,setReport]=useState<ProcurementReportRecord&{activity?:ProcurementAudit[]}>();
  const alive=useRef(true),selection=useRef<string|undefined>(undefined);
  const detailGeneration=useRef(0);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const load=useCallback(async()=>{
    const [s,t,r]=await Promise.all([procurementApi.suppliers(),procurementApi.tenders(),procurementApi.reports()]);
    if(!alive.current)return;setSuppliers(s);setTenders(t);setReports(r);setRefreshAt(new Date().toLocaleTimeString('zh-CN'));
  },[]);
  const openTender=useCallback(async(id:string)=>{
    const generation=++detailGeneration.current;
    selection.current=id;setSelectedId(id);setDetail(undefined);
    const d=await procurementApi.detail(id);if(alive.current&&selection.current===id&&generation===detailGeneration.current)setDetail(d);
  },[]);
  const run=useCallback(async<T,>(task:()=>Promise<T>):Promise<T|undefined>=>{
    setBusy(true);setError('');try{return await task();}catch(e){if(alive.current)setError(e instanceof Error?e.message:'操作失败');return undefined;}finally{if(alive.current)setBusy(false);}
  },[]);
  useEffect(()=>{
    void run(load);
    const params=new URLSearchParams(location.search),id=params.get('procurementTender'),reportId=params.get('procurementReport');
    if(id)void run(()=>openTender(id));if(reportId)void run(async()=>setReport(await procurementApi.report(reportId)));
  },[load,openTender,run]);
  useEffect(()=>{
    let cancelled=false,running=false;
    const timer=setInterval(async()=>{if(running||document.hidden||selection.current!==selectedId)return;running=true;const generation=++detailGeneration.current;try{
      const [t,d]=await Promise.all([procurementApi.tenders(),selectedId?procurementApi.detail(selectedId):Promise.resolve(undefined)]);
      if(!cancelled&&alive.current){setTenders(t);if(d&&selection.current===selectedId&&generation===detailGeneration.current)setDetail(d);setRefreshAt(new Date().toLocaleTimeString('zh-CN'));}
    }catch(e){if(!cancelled)setError(e instanceof Error?e.message:'刷新失败');}finally{running=false;}},5000);
    return()=>{cancelled=true;clearInterval(timer);};
  },[selectedId]);
  async function action(body:Record<string,unknown>) {
    if(!selectedId||selection.current!==selectedId)return;
    const id=selectedId;
    detailGeneration.current++;
    return run(async()=>{
      const d=await procurementApi.action(id,body);
      if(alive.current&&selection.current===id){detailGeneration.current++;setDetail(d);if(d.link)setLinks([d.link]);}
      await load();return d;
    });
  }
  return {suppliers,tenders,detail,selectedId,links,setLinks,error,busy,refreshAt,analysis,setAnalysis,reports,report,setReport,
    run,load,openTender,action,closeDetail:()=>{detailGeneration.current++;selection.current=undefined;setSelectedId(undefined);setDetail(undefined);},
  };
}
export type ProcurementController=ReturnType<typeof useProcurement>;
