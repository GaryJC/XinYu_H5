import {useState} from 'react';
import {Alert, Button, Empty, Pagination} from 'antd';
import {ChevronRight} from 'lucide-react';
import type {WorkloadState} from '../../../../shared/types';
import {LoadingState} from '../../shared/ui/LoadingState';
import {WorkerLoadChart} from './WorkerLoadChart';
import {useOperationsDashboard} from './useOperationsDashboard';
import {workloadLabels} from './workloadLabels';

export function PersonnelWorkload({onOpenOrder,revision}:{onOpenOrder:(id:string)=>void;revision:number}) {
  const {data,error,refresh} = useOperationsDashboard(String(revision));
  const [selected,setSelected] = useState<{workerId:string;state:WorkloadState}>();
  const [page,setPage] = useState(1);
  if (error) return <Alert type="error" showIcon title={error} action={<Button onClick={()=>void refresh()}>重试</Button>}/>;
  if (!data) return <LoadingState label="正在加载人员负荷…"/>;
  const orders = new Map<string,{plate:string;dispatchNo:string;projects:string[]}>();
  if (selected) {
    for (const project of data.projects) {
      if (project.ownerId !== selected.workerId || !project.flags.includes(selected.state)) continue;
      const order = orders.get(project.orderId) ?? {plate:project.plate,dispatchNo:project.dispatchNo,projects:[]};
      order.projects.push(project.name);
      orders.set(project.orderId,order);
    }
  }
  const pageSize = 20;
  const currentPage = Math.min(page,Math.max(1,Math.ceil(orders.size/pageSize)));
  return <>
    <WorkerLoadChart hideTitle workers={data.workers} selected={selected} onSelect={(workerId,state)=>{setSelected({workerId,state});setPage(1);}}/>
    {selected && <section className="onsite-load-selection" aria-live="polite">
      <h4>{data.workers.find(w=>w.id===selected.workerId)?.name} · {workloadLabels[selected.state]} · {orders.size} 单</h4>
      {orders.size === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该人员在此阶段暂无工单"/>}
      {Array.from(orders).slice((currentPage-1)*pageSize,currentPage*pageSize).map(([id,order])=>
        <button className="onsite-row" type="button" key={id} onClick={()=>onOpenOrder(id)}>
          <span><strong>{order.plate || '未登记车牌'}</strong> <span>{order.dispatchNo}</span><small>{order.projects.join('、')}</small></span>
          <ChevronRight size={17} aria-hidden="true"/>
        </button>)}
      {orders.size > pageSize && <Pagination size="small" simple={{readOnly:true}} current={currentPage} total={orders.size} pageSize={pageSize} showSizeChanger={false} onChange={setPage}/>}
    </section>}
  </>;
}
