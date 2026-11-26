import {Suspense, useEffect, useRef, useState} from 'react';
import {Alert, Button, Empty, Pagination, Popover} from 'antd';
import {
  ArrowUpRight, CalendarClock, CarFront, Check, ChevronDown, ChevronRight, ClipboardCheck,
  Clock3, History, Info, PackageOpen, UsersRound
} from 'lucide-react';
import type {OnsiteCategory, OnsiteOrder} from '../../../../shared/types';
import {lazy} from '../../shared/ui/recoverableLazy';
import {LoadingState} from '../../shared/ui/LoadingState';
import {RefreshButton} from '../../shared/ui/RefreshButton';
import {useOnsiteDashboard} from './useOnsiteDashboard';

const PersonnelWorkload = lazy(()=>import('./PersonnelWorkload').then(m=>({default:m.PersonnelWorkload})));
const categories = {
  aged:{label:'建单超 7 天未结束',heading:'建单超 7 天未结束',icon:History},
  overdue:{label:'已超预计完工时间',heading:'超期工单',icon:CalendarClock},
  parts:{label:'待备料',heading:'待备料工单',icon:PackageOpen},
  inspection:{label:'待检验',heading:'待检验工单',icon:ClipboardCheck}
} satisfies Record<OnsiteCategory,{label:string;heading:string;icon:typeof History}>;
const categoryKeys = Object.keys(categories) as OnsiteCategory[];
const displayDate = new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const displayTime = new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false});

function elapsed(since:string, now:string) {
  const minutes = Math.max(0,Math.floor((Date.parse(now)-Date.parse(since))/60000));
  if (minutes < 60) return `${minutes} 分钟`;
  if (minutes < 1440) return `${Math.floor(minutes/60)} 小时`;
  return `${Math.floor(minutes/1440)} 天`;
}

function OrderRow({order,category,now,onOpen}:{order:OnsiteOrder;category:OnsiteCategory;now:string;onOpen:(id:string)=>void}) {
  const waiting = order.projects.map(p=>p.waitingSince).filter((time):time is string=>Boolean(time)).sort()[0];
  const since = category==='aged' ? order.createdAt : category==='overdue' ? order.dueAt : waiting;
  const timing = since ? `${category==='aged'?'已建单':category==='overdue'?'超期':'已等待'} ${elapsed(since,now)}` : '等待起点未记录';
  return <button type="button" className="onsite-row onsite-order" onClick={()=>onOpen(order.orderId)}>
    <span className="onsite-identity">
      <span className="onsite-identity-title"><strong>{order.plate || '未登记车牌'}</strong><span className="onsite-stage">{order.stage}</span></span>
      {order.dispatchNo && <span className="onsite-dispatch">{order.dispatchNo}</span>}
    </span>
    <span className="onsite-job">
      {order.projects.map((project,i)=><span className="onsite-project" key={i}>
        <span className="onsite-project-name">{project.name}</span><span className="onsite-owner">{project.ownerName}</span>
        {category==='inspection' && <small>{project.waitingSince
          ? <time dateTime={project.waitingSince}>待检自 {displayDate.format(new Date(project.waitingSince))}</time>
          : '提检时间未记录'}</small>}
      </span>)}
    </span>
    <span className="onsite-schedule">
      <span className={category==='overdue' ? 'onsite-duration is-overdue' : 'onsite-duration'}><Clock3 size={13} aria-hidden="true"/>{timing}</span>
      {since && category!=='inspection' && <time className="onsite-date" dateTime={since}>
        {category==='aged'?'建单':category==='overdue'?'预计完工':'最早等待'} {displayDate.format(new Date(since))}
      </time>}
    </span>
    <ChevronRight className="onsite-open-order" size={16} aria-hidden="true"/>
  </button>;
}

export function OnsiteDashboardPage({onOpenOrder,onOpenReport,revision}:{onOpenOrder:(id:string)=>void;onOpenReport:(month:string)=>void;revision:number}) {
  const c = useOnsiteDashboard(revision);
  const data = c.data;
  const category = c.category ?? data?.category;
  const [workload,setWorkload] = useState(false);
  const [workloadRevision,setWorkloadRevision] = useState(0);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const navigating = useRef(false);
  useEffect(() => {
    if (!navigating.current || c.loading) return;
    navigating.current = false;
    listHeading.current?.scrollIntoView({block:'start'});
  },[data,c.loading]);

  return <section className="onsite-dashboard" aria-label="现场运营">
    <section className="onsite-summary" aria-labelledby="onsite-summary-title">
      <header className="onsite-heading">
        <h2 id="onsite-summary-title">待跟进工单</h2>
        <div className="onsite-updated">
          {data && <time dateTime={data.generatedAt} title={displayDate.format(new Date(data.generatedAt))}>
            {displayTime.format(new Date(data.generatedAt))} 更新
          </time>}
          <RefreshButton loading={c.loading} onClick={()=>{c.refresh();setWorkloadRevision(n=>n+1);}} label="刷新现场运营"/>
        </div>
      </header>
      {data && <div className="onsite-cards">{categoryKeys.map(key=>{
        const {label,icon:Icon} = categories[key];
        const selected = category===key;
        return <button key={key} type="button" className="onsite-card" aria-pressed={selected}
          onClick={()=>{if (!selected) c.selectCategory(key);}}>
          <span className="onsite-card-label"><Icon size={16} aria-hidden="true"/>{label}</span>
          <span className="onsite-card-amount"><strong>{data.counts[key]}</strong><span>单</span>
            {selected && <Check className="onsite-card-check" size={16} aria-hidden="true"/>}
          </span>
        </button>;
      })}</div>}
      {!data && !c.error && <LoadingState label="正在加载现场运营…"/>}
    </section>
    {c.error && <Alert className="onsite-error" type="error" showIcon title={c.error} action={<Button onClick={c.refresh}>重试</Button>}/>}
    {data && category && <div className="onsite-body">
      <section className="onsite-list" aria-label="现场工单明细" aria-busy={c.loading}>
        <header className="onsite-list-heading">
          <h3 ref={listHeading}>{categories[category].heading}<span>{data.counts[category]} 单</span></h3>
          <Popover trigger="click" placement="bottomRight" content="每类按工单去重，同一工单可出现在多个类别。">
            <button type="button" className="onsite-info" aria-label="查看工单统计口径"><Info size={16} aria-hidden="true"/></button>
          </Popover>
        </header>
        {c.loading ? <LoadingState label="正在加载工单明细…"/> : !c.error && <>
          {!data.total && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无此类工单"/>}
          {data.items.map(order=><OrderRow key={order.orderId} category={data.category} order={order} now={data.generatedAt} onOpen={onOpenOrder}/>)}
          {data.total>data.pageSize && <footer className="onsite-pagination">
            <span>第 {(data.page-1)*data.pageSize+1}–{Math.min(data.page*data.pageSize,data.total)} 单</span>
            <Pagination aria-label="现场工单分页" size="small" simple={{readOnly:true}} showSizeChanger={false}
              current={data.page} pageSize={data.pageSize} total={data.total} onChange={page=>{navigating.current=true;c.selectPage(page);}}/>
          </footer>}
        </>}
      </section>
      <div className="onsite-tools">
        <button type="button" className="onsite-vehicle" onClick={()=>onOpenReport(data.vehicle.month)}>
          <span className="onsite-tool-heading"><CarFront size={19} aria-hidden="true"/><strong>本月用车</strong><ArrowUpRight size={16} aria-hidden="true"/></span>
          <span className="onsite-vehicle-numbers">
            <span><span>用车次数</span><b>{data.vehicle.tripCount}</b></span>
            <span className="onsite-missed"><span>漏还车次数</span><b>{data.vehicle.missedReturnCount}</b></span>
          </span>
        </button>
        <details className="onsite-workload" onToggle={e=>setWorkload(e.currentTarget.open)}>
          <summary className="onsite-tool-heading"><UsersRound size={18} aria-hidden="true"/><strong>人员负荷</strong><ChevronDown size={16} aria-hidden="true"/></summary>
          {workload && <div className="onsite-workload-content"><Suspense fallback={<LoadingState label="正在加载人员负荷…"/>}><PersonnelWorkload revision={workloadRevision} onOpenOrder={onOpenOrder}/></Suspense></div>}
        </details>
      </div>
    </div>}
  </section>;
}
