import {useEffect,useState} from 'react';
import {Alert,Button} from 'antd';
import {ChevronDown,ChevronUp} from 'lucide-react';
import {vehicleTripApi} from '../vehicle-trips/vehicleTripApi';

export function TodoOverview({counters,canApprove,onTodo,onApprovals}:{counters:{label:string;value:number|undefined}[];canApprove:boolean;onTodo:(label:string)=>void;onApprovals:()=>void}) {
 const [expanded,setExpanded]=useState(false);
 const [count,setCount]=useState<number>();
 const [error,setError]=useState('');
 useEffect(()=>{
  if(!canApprove)return;
  let active=true;
  const load=()=>{void vehicleTripApi.page(1,'pending').then(page=>{if(active){setCount(page.total);setError('');}}).catch(()=>{if(active){setCount(undefined);setError('出车待审批数量加载失败');}});};
  load();const refresh=()=>{if(document.visibilityState==='visible')load();};
  document.addEventListener('visibilitychange',refresh);
  return()=>{active=false;document.removeEventListener('visibilitychange',refresh);};
 },[canApprove]);
 const order=['待客户签字','待派工','待检验','待审批','维修中'];
 const entries=[...counters,...(canApprove?[{label:'待审批',value:count}]:[])]
  .sort((a,b)=>order.indexOf(a.label)-order.indexOf(b.label));
 return <>
  <div className="workbench-section-heading"><div className="todo-overview-title"><h2>待办概览</h2>{entries.length>4&&<Button type="text" size="small" aria-label={expanded?'收起待办概览':'展开全部待办'} aria-expanded={expanded} aria-controls="todo-metrics" icon={expanded?<ChevronUp size={18}/>:<ChevronDown size={18}/>} onClick={()=>setExpanded(value=>!value)}>{expanded?'收起':`全部 ${entries.length} 项`}</Button>}</div><span>当前可见待办</span></div>
  {error&&<Alert type="warning" title={error}/>}
  <section id="todo-metrics" className="workbench-metrics" aria-label="全部待办统计">
   {(expanded?entries:entries.slice(0,4)).map((counter,index)=><button type="button" className={`workbench-metric metric-tone-${index}`} key={counter.label} aria-label={`查看${counter.label}事项`} onClick={()=>counter.label==='待审批'?onApprovals():onTodo(counter.label)}>
    <span className="workbench-metric-label"><i aria-hidden="true"/>{counter.label}<span className="metric-arrow" aria-hidden="true">›</span></span><strong>{counter.value??'—'}<small>单</small></strong>{counter.label==='待审批'&&<span className="todo-approval-caption">出车申请</span>}
   </button>)}
  </section>
 </>;
}
