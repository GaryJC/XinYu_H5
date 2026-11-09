import {useEffect,useState} from 'react';
import {Alert,Button,Drawer} from 'antd';
import {ChevronDown,ChevronUp,ChevronRight,FilePenLine,Network,ClipboardCheck,Clock3,Wrench} from 'lucide-react';
import {vehicleTripApi} from '../vehicle-trips/vehicleTripApi';

const todoAppearance: Record<string, { tone: string; icon: typeof Clock3 }> = {
 '待客户签字': { tone: 'amber', icon: FilePenLine },
 '待派工': { tone: 'blue', icon: Network },
 '待检验': { tone: 'teal', icon: ClipboardCheck },
 '待收车审核': { tone: 'violet', icon: Clock3 },
 '维修中': { tone: 'blue', icon: Wrench },
};

export function TodoOverview({counters,canApprove,onTodo,onApprovals}:{counters:{label:string;value:number|undefined}[];canApprove:boolean;onTodo:(label:string)=>void;onApprovals:()=>void}) {
 const [expanded,setExpanded]=useState(false);
 const [approvalsOpen,setApprovalsOpen]=useState(false);
 const [count,setCount]=useState<number>();
 const [error,setError]=useState('');
 useEffect(()=>{
  if(!canApprove)return;
  let active=true;
  const load=()=>{void vehicleTripApi.page(1,'return-review').then(page=>{if(active){setCount(page.total);setError('');}}).catch(()=>{if(active){setCount(undefined);setError('待收车审核数量加载失败');}});};
  load();const refresh=()=>{if(document.visibilityState==='visible')load();};
  document.addEventListener('visibilitychange',refresh);
  return()=>{active=false;document.removeEventListener('visibilitychange',refresh);};
 },[canApprove]);
 const approvalCategories=[{key:'vehicle-trip',label:'车辆归还',count,onOpen:onApprovals}];
 const approvalTotal=approvalCategories.every(category=>category.count!==undefined)?approvalCategories.reduce((sum,category)=>sum+(category.count||0),0):undefined;
 const order=['待客户签字','待派工','待检验','待收车审核','维修中'];
 const entries=[...counters,...(canApprove?[{label:'待收车审核',value:approvalTotal}]:[])]
  .sort((a,b)=>order.indexOf(a.label)-order.indexOf(b.label));
 return <>
  <div className="workbench-section-heading"><div className="todo-overview-title"><h2>待办概览</h2>{entries.length>4&&<Button type="text" size="small" aria-label={expanded?'收起待办概览':'展开全部待办'} aria-expanded={expanded} aria-controls="todo-metrics" icon={expanded?<ChevronUp size={18}/>:<ChevronDown size={18}/>} onClick={()=>setExpanded(value=>!value)}>{expanded?'收起':`全部 ${entries.length} 项`}</Button>}</div></div>
  {error&&<Alert type="warning" title={error}/>}
  <section id="todo-metrics" className="workbench-metrics" aria-label="全部待办统计">
   {(expanded ? entries : entries.slice(0, 4)).map(counter => {
    const appearance = todoAppearance[counter.label] ?? { tone: 'blue', icon: Clock3 };
    const Icon = appearance.icon;
    return <button type="button" className={`workbench-metric metric-tone-${appearance.tone}`} key={counter.label} aria-label={`查看${counter.label}事项`} onClick={() => counter.label === '待收车审核' ? setApprovalsOpen(true) : onTodo(counter.label)}>
      <span className="workbench-metric-label"><span className="metric-icon"><Icon size={18} aria-hidden="true" /></span>{counter.label}<ChevronRight className="metric-arrow" size={16} aria-hidden="true" /></span>
      <strong>{counter.value ?? '—'}<small>{counter.label === '待收车审核' ? '项' : '单'}</small></strong>
    </button>;
   })}
  </section>
  <Drawer title="待收车审核" placement="bottom" size="auto" open={canApprove&&approvalsOpen} onClose={()=>setApprovalsOpen(false)} styles={{wrapper:{maxHeight:'80vh'},body:{overflowY:'auto'}}}>
   <div className="approval-category-list">{approvalCategories.map(category=><button type="button" key={category.key} aria-label={`查看${category.label}待收车审核事项`} onClick={()=>{setApprovalsOpen(false);category.onOpen();}}><span>{category.label}</span><span><strong>{category.count??'—'}</strong> 项<span aria-hidden="true"> ›</span></span></button>)}</div>
  </Drawer>
 </>;
}
