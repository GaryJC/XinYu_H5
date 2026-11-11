import {RefreshButton} from '../../shared/ui/RefreshButton';
import {NotificationUsagePanel} from '../notifications/NotificationUsagePanel';
import {useMemo,useState,type ReactNode} from 'react';
import {Alert,Button,Empty,Select,Skeleton} from 'antd';
import {ArrowDownRight,ArrowUpRight} from 'lucide-react';
import type {EChartsCoreOption} from 'echarts/core';
import type {AnalyticsComparison} from '../../../../shared/types';
import {Chart} from '../../shared/charts/Chart';
import {useOperationsDashboard} from '../operations-dashboard/useOperationsDashboard';
import {useBusinessAnalytics} from './useBusinessAnalytics';
import {barOption,donutOption,monthOption,trendOption} from './chartOptions';
import './business-analytics.css';
import {WorkerLoadChart} from '../operations-dashboard/WorkerLoadChart';

type ChartPanelProps={title:string;description:string;option:EChartsCoreOption;rows:Array<Array<string|number>>;columns:string[];empty?:boolean;height?:number;children?:ReactNode;className?:string};
function ChartPanel({title,description,option,rows,columns,empty,height,children,className=''}:ChartPanelProps){
  return <section className={`analytics-panel ${className}`}><header><div><h3>{title}</h3><p>{description}</p></div>{children}</header>
    {empty?<div className="analytics-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="此范围内暂无可统计数据"/></div>:<Chart option={option} label={`${title}。${description}`} height={height}/>}
    <details className="analytics-data"><summary>查看图表数据</summary><div className="analytics-data-scroll"><table><thead><tr>{columns.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody></table></div></details>
  </section>;
}
function Comparison({metric}:{metric:AnalyticsComparison}){
  const {change,value,previous}=metric;
  return <span className={`analytics-change ${change===null||change===0?'is-flat':change>0?'is-up':'is-down'}`}>
    {change!==null&&change!==0&&(change>0?<ArrowUpRight size={14}/>:<ArrowDownRight size={14}/>)}
    {change===null?(value>0?'上期为 0，新增 '+value:'两期均为 0'):change===0?'与上期持平':`${Math.abs(change)}%`}
    <small>上期 {previous}</small>
  </span>;
}
export function BusinessAnalyticsPage(){
  const [days,setDays]=useState(30),[compare,setCompare]=useState(false);
  const c=useBusinessAnalytics(days),load=useOperationsDashboard();const d=c.data;
  const charts=useMemo(()=>d?{trend:trendOption(d,compare),month:monthOption(d),customers:barOption(d.customers,true),mix:donutOption(d.vehicleMix),cycle:barOption(d.cycleBuckets,false,'#2ba69a'),aging:barOption(d.aging,false,'#e7b35a'),status:donutOption(d.status),execution:donutOption(d.execution)}:undefined,[d,compare]);
  const workers=load.data?.workers||[];
  const countRows=(rows:Array<{name:string;value:number}>)=>rows.map(r=>[r.name,r.value]);
  return <div className="business-analytics">
    <header className="analytics-heading"><div><h2>门店经营概览</h2></div><div className="analytics-controls"><Select aria-label="经营分析统计周期" value={days} onChange={setDays} options={[7,30,90,180,365].map(value=>({value,label:`近 ${value} 天`}))}/><RefreshButton aria-label="刷新经营分析" loading={c.loading||load.loading} onClick={()=>{void c.refresh();void load.refresh();}} label="刷新"/></div></header>
    <NotificationUsagePanel/>
    {c.error&&<Alert type="error" showIcon title="经营数据加载失败" description={c.error} action={<Button onClick={()=>void c.refresh()}>重试</Button>}/>}
    {c.loading&&<Skeleton active paragraph={{rows:8}}/>}
    {d&&charts&&<>
      <div className="analytics-range"><span>{d.range.from} — {d.range.to}</span><span>对比 {d.range.previousFrom} — {d.range.previousTo} · 北京时间 · 不含今天</span></div>
      <section className="analytics-kpis" aria-label="经营核心指标">
        {([{key:'orders',label:'新建委托单',unit:'单'},{key:'completed',label:'首次完工委托单',unit:'单'},{key:'vehicles',label:'服务车辆',unit:'辆'}] as const).map(({key,label,unit})=><article className={`analytics-kpi ${key==='orders'?'is-primary':''}`} key={key}><span>{label}</span><strong>{d.kpis[key].value}<small>{unit}</small></strong><Comparison metric={d.kpis[key]}/></article>)}
        <article className="analytics-kpi"><span>维修周转中位数</span><strong>{d.kpis.cycleDays.value??'—'}<small>天</small></strong><span className="analytics-cycle-note">上期 {d.kpis.cycleDays.previous??'—'} 天 · 本期 {d.kpis.cycleDays.samples} 个样本</span></article>
      </section>
      <div className="analytics-insight"><span className="analytics-insight-dot"/><p>{d.kpis.orders.previous===0?`本期新增 ${d.kpis.orders.value} 张委托单，上期为 0，暂不计算增长率。`:`本期开单量较上期${d.kpis.orders.value>=d.kpis.orders.previous?'增加':'减少'} ${Math.abs(d.kpis.orders.value-d.kpis.orders.previous)} 单（${Math.abs(d.kpis.orders.change||0)}%）。`} 本期首次完工 {d.kpis.completed.value} 单，当前尚未维修结束 {d.liveCount} 单。</p></div>
      <div className="analytics-section-title"><h3>业务趋势</h3><span>期间发生量 · 与上期比较</span></div>
      <div className="analytics-grid analytics-trends">
        <ChartPanel title="开单与完工趋势" description={compare?'上期按第 1 天起对齐；具体日期可展开数据查看。':'按天统计新建和首次完工；两条序列对应各自发生时间。'} option={charts.trend} empty={!d.daily.some(r=>r.created||r.completed||r.previous)} columns={['日期','新建','首次完工','对比日期','上期新建']} rows={d.daily.map(r=>[r.date,r.created,r.completed,r.previousDate,r.previous])} height={320}><Button size="small" aria-pressed={compare} onClick={()=>setCompare(v=>!v)}>{compare?'查看开单 / 完工':'对比上期'}</Button></ChartPanel>
        <ChartPanel title="过去 12 个月开单量" description="固定 12 个月视角；* 为尚未结束的当月。" option={charts.month} empty={!d.monthly.some(r=>r.value)} columns={['月份','新建委托单']} rows={d.monthly.map(r=>[r.month+(r.partial?'（未结束）':''),r.value])} height={320}/>
      </div>
      <div className="analytics-section-title"><h3>业务来自哪里</h3><span>所选期间新建委托单</span></div>
      <div className="analytics-grid">
        <ChartPanel title="托修单位贡献" description={`按委托单量排序，共 ${d.customerCount} 个已登记单位；显示前 6 名，其余合并。`} option={charts.customers} empty={!d.customers.length} columns={['托修单位','委托单量']} rows={countRows(d.customers)}/>
        <ChartPanel title="首次记录与历史到店车辆" description="VIN 优先、车牌兜底去重；本期首次出现在系统中的车辆算首次记录，不等同于新客户。" option={charts.mix} empty={!d.kpis.vehicles.value} columns={['车辆类型','车辆数']} rows={countRows(d.vehicleMix)}/>
        <ChartPanel title="维修方式构成" description="按所选期间新建委托单的当前维修方式分类。" option={charts.execution} empty={!d.execution.length} columns={['维修方式','委托单量']} rows={countRows(d.execution)}/>
        <ChartPanel title="维修周转分布" description="本期首次完工样本：从建单到首次维修完成的日历时长，含等待时间，不代表实际工时。" option={charts.cycle} empty={!d.kpis.cycleDays.samples} columns={['周转时间','完工单量']} rows={countRows(d.cycleBuckets)}/>
      </div>
      <div className="analytics-section-title"><h3>当前运营压力</h3><span>当前快照 · 不随日期筛选变化</span></div>
      <div className="analytics-grid">
        <ChartPanel title="未结束工单账龄" description={`当前 ${d.liveCount} 单尚未维修结束，按建单至今时长分组，包含待签字和待派工。`} option={charts.aging} empty={!d.liveCount} columns={['建单时长','未结束单量']} rows={countRows(d.aging)}/>
        <ChartPanel title="全部委托单当前状态" description="系统内全部有效委托单的当前状态分布，含已维修完成工单。" option={charts.status} empty={!d.status.length} columns={['当前状态','委托单量']} rows={countRows(d.status)}/>
      </div>
      {load.error?<Alert type="warning" title="人员负荷暂未更新" description={load.error}/>:load.loading&&!load.data?<Skeleton active/>:<section className="analytics-panel"><WorkerLoadChart workers={workers}/></section>}
      <footer className="analytics-method"><h4>数据口径</h4><p>数据更新于 {new Date(d.generatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}，点击页面顶部刷新可重新获取。</p><p>开单按系统创建时间统计，排除草稿和待处理纸质委托书；补录历史单会体现在补录日期。首次完工合并任务、维修轮次和操作记录，每张委托单只计一次，返工不重复增加完工单量。</p><p>当前数据中有 {d.quality.missingCompletion} 张已完工单缺少有效完工时间，未计入完工趋势及周期；本期 {d.quality.missingVehicle} 单缺少车辆标识，未计入车辆去重。{d.quality.invalidCreated>0?`${d.quality.invalidCreated} 单缺少有效建单时间，未计入分析。`:''}所有图表均包含系统内测试记录，请在解读正式业务趋势时留意。</p><p>本版展示业务量与周转变化。现有金额尚未确认结算、收款口径，因此暂不展示营业收入、利润或增长预测。</p></footer>
    </>}
  </div>;
}
