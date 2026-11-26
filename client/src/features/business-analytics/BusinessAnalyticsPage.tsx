import {memo, useState, type ReactNode} from 'react';
import {Alert, Button, DatePicker, Empty, Skeleton} from 'antd';
import {ArrowLeftRight, ArrowUpRight, CalendarDays, CalendarRange, CarFront, ChevronDown, ChevronRight, Table2, Wrench, type LucideIcon} from 'lucide-react';
import dayjs from 'dayjs';
import type {EChartsCoreOption} from 'echarts/core';
import type {AnalyticsComparison, AnalyticsCount, BusinessAnalytics} from '../../../../shared/types';
import {Chart} from '../../shared/charts/Chart';
import {RefreshButton} from '../../shared/ui/RefreshButton';
import {AnalyticsOrderList, orderLabels, type OrderMetric} from './AnalyticsOrderList';
import {barOption, donutOption, monthOption, trendOption} from './chartOptions';
import {useBusinessAnalytics} from './useBusinessAnalytics';
import './business-analytics.css';

type ChartPanelProps = {
  title:string; description?:string; option:EChartsCoreOption;
  rows:Array<Array<string|number>>; columns:string[]; empty?:boolean; children?:ReactNode;
  variant?:'main'|'inset';
};
function ChartPanel({title, description, option, rows, columns, empty, children, variant}:ChartPanelProps) {
  return <section className={'analytics-panel' + (variant ? ' analytics-panel-' + variant : '')} aria-label={title}>
    <header><div>{variant !== 'inset' && <h3>{title}</h3>}{description && <p>{description}</p>}</div>{children}</header>
    {empty ? <div className="analytics-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本期暂无数据"/></div> : <>
      <Chart option={option} label={title} height={variant === 'main' ? 282 : 228}/>
      <details className="analytics-data"><summary><Table2 size={14} aria-hidden="true"/>查看图表数据<ChevronDown size={14} aria-hidden="true"/></summary>
        <div className="analytics-data-scroll"><table>
          <thead><tr>{columns.map(c=><th scope="col" key={c}>{c}</th>)}</tr></thead>
          <tbody>{rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody>
        </table></div>
      </details>
    </>}
  </section>;
}

function Comparison({metric, shortened}:{metric:AnalyticsComparison; shortened:boolean}) {
  const value = metric.comparableValue ?? metric.value;
  const delta = value - metric.previous;
  const change = metric.change;
  return <span className="analytics-change">
    <span className="analytics-change-value">{delta === 0 ? '持平' : change === null ? `新增 ${value}` : `${delta > 0 ? '+' : '−'}${Math.abs(change)}%`}</span>
    <small>{shortened ? `可比 ${value} / 上月 ${metric.previous}` : `上月 ${metric.previous}`}</small>
  </span>;
}

const countRows = (rows:AnalyticsCount[]) => rows.map(r=>[r.name,r.value]);

function OptionalChart({title, icon:Icon, children}:{title:string; icon:LucideIcon; children:()=>ReactNode}) {
  const [open, setOpen] = useState(false);
  return <details className="analytics-optional" onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary><Icon size={17} aria-hidden="true"/>{title}<ChevronDown size={15} aria-hidden="true"/></summary>
    {open && children()}
  </details>;
}

const MonthCharts = memo(function MonthCharts({data:d}:{data:BusinessAnalytics}) {
  const [compare,setCompare] = useState(false);
  return <>
    <ChartPanel variant="main" title={compare ? '本月与上月开单趋势' : '开单与完工趋势'} option={trendOption(d,compare)}
      description={compare ? '按月内同一天对齐。' : undefined}
      empty={!d.daily.some(r=>r.created || (compare ? r.previous : r.completed))}
      columns={['日期','新建','首次完工','对比日期','上月新建']}
      rows={d.daily.map(r=>[r.date,r.created,r.completed,r.previousDate || '—',r.previous ?? '—'])}>
      <button type="button" className="analytics-compare" aria-pressed={compare} onClick={()=>setCompare(value=>!value)}><ArrowLeftRight size={14} aria-hidden="true"/>{compare?'查看开单与完工':'对比上月开单'}</button>
    </ChartPanel>
    <div className="analytics-grid">
      <ChartPanel title="托修单位贡献" description={`本期共 ${d.customerCount} 个已登记单位。按新建委托单量列前 6 名，其余合并。`} option={barOption(d.customers,true)}
        empty={!d.customers.length} columns={['单位','委托单量']} rows={countRows(d.customers)}/>
      <ChartPanel title="维修周转分布" description="从建单到首次完工的日历天数，包含等待时间。" option={barOption(d.cycleBuckets,false,'#326d86')}
        empty={!d.kpis.cycleDays.samples} columns={['周转时间','完工单量']} rows={countRows(d.cycleBuckets)}/>
    </div>
    <div className="analytics-options">
      <OptionalChart title="12 个月开单趋势" icon={CalendarRange}>{()=> <ChartPanel variant="inset" title="月度开单量" description="星号表示尚未结束的月份。"
        option={monthOption(d)} empty={!d.monthly.some(r=>r.value)} columns={['月份','开单量']} rows={d.monthly.map(r=>[r.month+(r.partial?'（未结束）':''),r.value])}/>}</OptionalChart>
      <OptionalChart title="车辆构成" icon={CarFront}>{()=> <ChartPanel variant="inset" title="首次记录与历史到店车辆" description="按首次记录和历史到店分类，以 VIN 优先、车牌兜底去重。"
        option={donutOption(d.vehicleMix)} empty={!d.kpis.vehicles.value} columns={['车辆类型','车辆数']} rows={countRows(d.vehicleMix)}/>}</OptionalChart>
      <OptionalChart title="维修方式" icon={Wrench}>{()=> <ChartPanel variant="inset" title="维修方式构成" description="按本期新建工单的当前维修方式统计。"
        option={donutOption(d.execution)} empty={!d.execution.length} columns={['维修方式','工单量']} rows={countRows(d.execution)}/>}</OptionalChart>
    </div>
  </>;
});

export function BusinessAnalyticsPage({onOpenOrder}:{onOpenOrder:(id:string)=>void}) {
  const currentMonth = new Date(Date.now()+8*3600000).toISOString().slice(0,7);
  const [month,setMonth] = useState(currentMonth);
  const [metric,setMetric] = useState<OrderMetric>();
  const report = useBusinessAnalytics(month);
  const d = report.data;
  const shorter = Boolean(d?.range.comparableTo && d.range.comparableTo !== d.range.to);
  function selectMonth(next:string) {
    setMetric(undefined);
    setMonth(next);
  }

  return <section className="business-analytics" aria-label="经营复盘">
    <div className="analytics-overview">
      <header className="analytics-report-head">
        <div className="analytics-controls">
          <label htmlFor="monthly-analytics-period" className="analytics-month-icon"><CalendarDays size={20} aria-hidden="true"/><span className="analytics-sr-only">统计月份</span></label>
          <DatePicker id="monthly-analytics-period" picker="month" format="YYYY年MM月" value={dayjs(month+'-01')}
            maxDate={dayjs(currentMonth+'-01').endOf('month')} allowClear={false} inputReadOnly variant="borderless" suffixIcon={<ChevronDown size={16}/>}
            onChange={value=>{if(value) selectMonth(value.format('YYYY-MM'));}}/>
          <RefreshButton loading={report.loading} onClick={report.refresh} label="刷新经营复盘"/>
        </div>
        {d && d.range.days > 0 && <div className="analytics-range"><span>{d.range.from} 至 {d.range.to} · 北京时间{month === currentMonth ? '，截至昨天' : '，整月'}</span>
          <span>对比 {d.range.previousFrom} 至 {d.range.previousTo}</span>
          {shorter && <span>本期环比截至 {d.range.comparableTo}</span>}
        </div>}
      </header>
      {report.error && <Alert type="error" showIcon title="经营数据加载失败" description={report.error} action={<Button onClick={report.refresh}>重试</Button>}/>}
      {report.loading && !d && <Skeleton active paragraph={{rows:5}}/>}
      {d && (d.range.days === 0 ? <Empty description="本月尚无完整自然日，可先查看上月经营数据。">
        <Button onClick={()=>selectMonth(dayjs(month+'-01').subtract(1,'month').format('YYYY-MM'))}>查看上月</Button>
      </Empty> :
        <section className="analytics-kpis" aria-label="经营核心指标">
          {(['orders','completed'] as const).map(key=><button type="button" key={key} className="analytics-kpi analytics-kpi-action"
            aria-label={`查看${orderLabels[key]}明细，共 ${d.kpis[key].value} 单`} onClick={()=>setMetric(key)}>
            <span>{orderLabels[key]}<ArrowUpRight size={15} aria-hidden="true"/></span>
            <strong>{d.kpis[key].value}<small>单</small></strong><Comparison metric={d.kpis[key]} shortened={shorter}/>
          </button>)}
          <article className="analytics-kpi"><span>服务车辆</span><strong>{d.kpis.vehicles.value}<small>辆</small></strong>
            <Comparison metric={d.kpis.vehicles} shortened={shorter}/></article>
          <article className="analytics-kpi"><span>维修周转中位数</span><strong>{d.kpis.cycleDays.value ?? '—'}<small>天</small></strong>
            <span className="analytics-cycle-note">{shorter && `可比 ${d.kpis.cycleDays.comparableValue ?? '—'} 天 / `}上月 {d.kpis.cycleDays.previous ?? '—'} 天 · 本期 {d.kpis.cycleDays.samples} 单</span></article>
        </section>
      )}
    </div>
    {d && d.range.days > 0 && <>
      <MonthCharts data={d}/>
      <details className="analytics-method"><summary>数据口径<ChevronRight size={15} aria-hidden="true"/></summary>
        <p>开单按系统建单日期统计，历史单补录计入补录当天。统计排除草稿和待处理纸质委托书。首次完工取任务、维修轮次和操作记录中最早的有效完工时间，每张委托单只计一次。</p>
        <p>全店有 {d.quality.missingCompletion} 张已完工单缺少有效完工时间，完工趋势与周转时长已排除这些记录。本期有 {d.quality.missingVehicle} 单缺少车辆标识，服务车辆数已排除这些记录。{d.quality.invalidCreated > 0 && `全店另有 ${d.quality.invalidCreated} 张单缺少有效建单时间，已排除。`}</p>
        <p>业务量和周转指标包含系统内的测试记录。营业收入、利润和增长预测需另行确认结算与收款口径。数据更新于 {new Date(d.generatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}。</p>
      </details>
    </>}
    {metric && <AnalyticsOrderList month={month} metric={metric} onClose={()=>setMetric(undefined)} onOpenOrder={onOpenOrder}/>}
  </section>;
}
