import {useEffect,useMemo,useState} from 'react';
import {Alert,Button,Empty,Select,Spin,Tag} from 'antd';
import {RefreshCcw,ArrowUpRight,Users,TriangleAlert,ChevronDown} from 'lucide-react';
import type {OperationsMetric} from '../../../../shared/types';
import {useOperationsDashboard} from './useOperationsDashboard';
import './operations-dashboard.css';
const labels:Record<OperationsMetric,string>={unfinished:'未完成',working:'维修中',waiting:'未开工',parts:'待备料',pickup:'待出库',paused:'暂停',inspection:'待检验',overdue:'超期'};
const metrics=Object.keys(labels) as OperationsMetric[];
const time=(value?:string)=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未记录';
export function OperationsDashboardPage({onOpen,embedded=false,refreshKey}:{onOpen:(id:string)=>void;embedded?:boolean;refreshKey?:string}){
 const c=useOperationsDashboard(refreshKey);const [expanded,setExpanded]=useState(false);const [owner,setOwner]=useState<string>();const [metric,setMetric]=useState<OperationsMetric>();const [sort,setSort]=useState<OperationsMetric>('unfinished');
 const workers=useMemo(()=>[...(c.data?.workers||[])].sort((a,b)=>b.counts[sort]-a.counts[sort]||a.name.localeCompare(b.name)),[c.data,sort]);
 const projects=(c.data?.projects||[]).filter(p=>(!owner||p.ownerId===owner)&&(!metric||p.flags.includes(metric))).sort((a,b)=>Number(b.flags.includes('overdue'))-Number(a.flags.includes('overdue'))||(a.waitingSince||'9999').localeCompare(b.waitingSince||'9999'));
 useEffect(()=>{if(metric)document.getElementById('operations-projects')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});},[metric,owner]);
 function choose(key:OperationsMetric,id?:string){setMetric(key);setOwner(id);}
 return <section className={`operations-dashboard ${embedded?'dispatch-workload workload-board operations-embedded':''}`} aria-label={embedded?'工作负荷看板':'数据看板'}>
  {embedded&&<h3><button className="workload-board-toggle" type="button" aria-expanded={expanded} aria-controls="dispatch-workload-content" onClick={()=>setExpanded(value=>!value)}><span>工作负荷看板{c.data&&<small> · {workers.length} 人</small>}</span><span className="workload-board-toggle-hint">{expanded?'收起':'展开'}<ChevronDown size={16} style={{transform:expanded?'rotate(180deg)':undefined}}/></span></button></h3>}
  {(!embedded||expanded)&&<div id={embedded?'dispatch-workload-content':undefined} className="operations-dashboard-content">
  {!embedded&&<header className="operations-header"><div><span className="operations-eyebrow">门店运行 · 实时负荷</span><h2>数据看板</h2><p>从人员负荷到任务卡点，让每一次派工都有依据。</p></div><Button icon={<RefreshCcw size={15}/>} loading={c.loading} onClick={()=>void c.refresh()}>刷新数据</Button></header>}
  {c.error&&<Alert type="error" showIcon title={c.error} description="当前数据可能不是最新，请刷新重试。"/>}
  {!c.data?c.loading?<Spin/>:<Empty description="暂无看板数据"/>:<>
   {!embedded&&<div className="operations-timestamp">当前快照 · {time(c.data.generatedAt)} · 按本店可见任务统计</div>}
   {!embedded&&<section className="operations-kpis" aria-label="门店当前负荷">
    <div className="operations-kpi"><span>未完成车辆</span><strong>{c.data.vehicles}<small>辆</small></strong><p>已签字，维修尚未结束</p></div>
    {(['working','parts','inspection','overdue'] as OperationsMetric[]).map(key=><button key={key} className={`operations-kpi ${key==='overdue'?'is-risk':''}`} onClick={()=>choose(key)}><span>{labels[key]}<ArrowUpRight size={15}/></span><strong>{c.data!.counts[key]}<small>项</small></strong><p>查看对应维修项目</p></button>)}
   </section>}
   {!embedded&&(c.data.unassigned>0||c.data.uncertain>0)&&<Alert type="warning" showIcon title={`${c.data.unassigned} 个项目待指定负责人 · ${c.data.uncertain} 张历史任务待核对`} description="未明确归属的项目不会计入个人负荷；待核对历史任务不计入项目统计。"/>}
   <section className="operations-panel"><div className="operations-panel-heading"><div>{!embedded&&<h3><Users size={18}/>维修工负荷</h3>}<p>按本人项目统计；待料、暂停和超期可能重叠，不能相加。</p></div><Select aria-label="维修工负荷排序" value={sort} onChange={setSort} options={metrics.map(value=>({value,label:`${labels[value]}最多`}))}/></div>
    <div className="operations-table-scroll"><table className="operations-table"><thead><tr><th>维修工 / 车辆</th>{metrics.map(key=><th key={key}>{labels[key]}</th>)}</tr></thead><tbody>{workers.map(w=><tr key={w.id}><th><strong>{w.name}</strong><small>{w.vehicles} 辆车{!w.assignable?' · 不可新派工':''}</small></th>{metrics.map(key=><td key={key}><button aria-label={`${w.name}，${labels[key]} ${w.counts[key]} 项`} className={w.counts[key]&&key==='overdue'?'is-risk':''} onClick={()=>choose(key,w.id)}>{w.counts[key]}</button></td>)}</tr>)}</tbody></table></div>
    {!workers.length&&<Empty description="暂无维修工记录"/>}<p className="operations-footnote">0 项仅表示暂无系统内未完成任务，不代表员工在岗或空闲。多人协作车辆在个人行分别计数，门店车辆去重。</p>
   </section>
   {(!embedded||metric)&&<section className="operations-panel" id="operations-projects"><div className="operations-panel-heading"><div><h3><TriangleAlert size={18}/>{metric?labels[metric]:'任务与卡点'} · {projects.length} 项</h3><p>超期优先，其次按有记录的等待开始时间排序。</p></div><Button onClick={()=>{setMetric(undefined);setOwner(undefined);}}>重置筛选</Button></div>
    <div className="operations-filters"><Select allowClear placeholder="全部维修工（含未分配及外包）" aria-label="筛选维修工" value={owner} onChange={setOwner} options={workers.map(w=>({value:w.id,label:w.name}))}/><Select allowClear placeholder="全部项目" aria-label="筛选任务状态" value={metric} onChange={setMetric} options={metrics.map(value=>({value,label:labels[value]}))}/></div>
    <div className="operations-project-list">{projects.slice(0,100).map(p=><button className="operations-project" key={p.key} onClick={()=>onOpen(p.orderId)}><div><strong>{p.plate||'未登记车牌'} <span>{p.dispatchNo||'暂无派工号'}</span></strong><ArrowUpRight size={17}/></div><h4>{p.name}</h4><p>{p.ownerName} · {p.status}</p><div className="operations-tags">{p.flags.filter(f=>['parts','pickup','paused','inspection','overdue'].includes(f)).map(f=><Tag color={f==='overdue'?'red':f==='parts'?'gold':'blue'} key={f}>{labels[f]}</Tag>)}</div>{p.note&&<p>{p.note}</p>}<small>预计完工：{time(p.dueAt)}{p.waitingSince?` · 等待开始：${time(p.waitingSince)}`:''}</small></button>)}</div>
    {!projects.length&&<Empty description="没有符合条件的项目"/>}{projects.length>100&&<p>当前显示前 100 项，请选择人员或状态缩小范围。</p>}
   </section>}
  </>}
 </div>}
 </section>;
}
