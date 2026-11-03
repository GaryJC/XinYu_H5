import {lazy,Suspense,useState} from 'react';
import {Alert,Button,Spin} from 'antd';
import {DownOutlined} from '@ant-design/icons';
import type {DispatchFilters,WorkloadState} from '../../../../shared/types';
import {workloadLabels} from '../operations-dashboard/workloadLabels';
import {useOperationsDashboard} from '../operations-dashboard/useOperationsDashboard';
import './dispatch-workload-chart.css';
const WorkerLoadChart=lazy(()=>import('../operations-dashboard/WorkerLoadChart').then(m=>({default:m.WorkerLoadChart})));
export function DispatchWorkloadChart({refreshKey,filters,onSelect,onClear}:{refreshKey:string;filters:DispatchFilters;onSelect:(id:string,state:WorkloadState)=>void;onClear:()=>void}){
  const [expanded,setExpanded]=useState(false);
  const c=useOperationsDashboard(refreshKey,'/api/dispatch/workload',expanded);
  const person=c.data?.workers.find(w=>w.id===filters.technicianId);
  const loading=<div className="dispatch-workload-chart-loading" role="status" aria-label="正在加载维修负荷图表"><Spin/></div>;
  return <section className="dispatch-workload workload-board" aria-label="维修工在手项目分布"><h3><button className="workload-board-toggle" type="button" aria-expanded={expanded} aria-controls="dispatch-workload-chart" onClick={()=>setExpanded(v=>!v)}><span>维修工在手项目分布</span><span className="workload-board-toggle-hint">{expanded?'收起':'展开'}<DownOutlined aria-hidden="true" className={expanded?'is-expanded':''}/></span></button></h3>
    {expanded&&<div id="dispatch-workload-chart" className="dispatch-workload-chart-body">
      {c.error&&<Alert type="error" showIcon title={c.error} action={<Button onClick={()=>void c.refresh()}>重试</Button>}/>}
      {filters.workloadState&&<div className="dispatch-workload-chart-selection"><span>已筛选：{person?.name||'所选维修工'} · {workloadLabels[filters.workloadState]}</span><Button size="small" onClick={onClear}>清除负荷筛选</Button></div>}
      {!c.data?c.loading?loading:null:<Suspense fallback={loading}><WorkerLoadChart hideTitle workers={c.data.workers} selected={{workerId:filters.technicianId,state:filters.workloadState}} onSelect={onSelect}/></Suspense>}
    </div>}
  </section>;
}
