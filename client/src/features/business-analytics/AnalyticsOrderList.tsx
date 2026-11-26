import {Alert, Button, Drawer, Empty, Grid} from 'antd';
import {CalendarDays, ChevronRight} from 'lucide-react';
import type {AnalyticsOrderRow} from '../../../../shared/types';
import {usePagedList} from '../../shared/hooks/usePagedList';
import {ListPagination} from '../../shared/ui/ListPagination';
import {LoadingState} from '../../shared/ui/LoadingState';
import {request} from '../../shared/api/httpClient';

export type OrderMetric = 'orders' | 'completed';
export const orderLabels = {orders:'新建委托单', completed:'首次完工委托单'} as const;
const orderTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit',
  hour:'2-digit', minute:'2-digit', hour12:false
});

export function AnalyticsOrderList({month, metric, onClose, onOpenOrder}:{
  month:string; metric:OrderMetric; onClose:()=>void; onOpenOrder:(id:string)=>void;
}) {
  const mobile = !Grid.useBreakpoint().md;
  const list = usePagedList<AnalyticsOrderRow>(`${month}:${metric}`, (page, signal) => {
    const params = new URLSearchParams({month, metric, page:String(page), pageSize:'20'});
    return request(`/api/dashboard/analytics/orders?${params}`, {signal});
  }, mobile, true, item => item.id);
  const title = orderLabels[metric] + '明细';
  const dateLabel = metric === 'orders' ? '建单时间' : '首次完工时间';
  return <Drawer open title={title} size="large" onClose={onClose} className="monthly-order-drawer">
    <div className="monthly-order-range">
      <span><CalendarDays size={17} aria-hidden="true"/><time dateTime={month}>{month.replace('-', ' 年 ')} 月</time></span>
      {!list.error && <span>{list.loading && !list.items.length ? '正在加载' : <>共 <b>{list.total}</b> 单</>}</span>}
    </div>
    {list.error && <Alert showIcon type="error" title={list.error} action={<Button onClick={()=>void list.refresh()}>重试</Button>}/>}
    {list.loading && !list.items.length && <LoadingState label="正在加载工单明细…"/>}
    {!list.loading && !list.error && !list.total && <Empty description="本月暂无对应工单"/>}
    {list.items.length > 0 && <div className="monthly-order-labels" aria-hidden="true"><span>车辆 / 派工号</span><span>{dateLabel}</span><span>当前状态</span></div>}
    <ul className="monthly-order-list">{list.items.map(row => {
      const date = metric === 'orders' ? row.createdAt : row.firstCompletedAt;
      return <li key={row.id}><button type="button" aria-label={`查看原单：${row.dispatchNo || row.id}，${row.plate || '未登记车牌'}`} onClick={()=>onOpenOrder(row.id)}>
        <span className="monthly-order-primary"><strong>{row.plate || '未登记车牌'}</strong><span className="monthly-order-number">{row.dispatchNo || row.id}</span></span>
        <span className="monthly-order-time"><span>{dateLabel} </span>{date ? <time dateTime={date}>{orderTime.format(new Date(date))}</time> : '—'}</span>
        <span className="monthly-order-stage">{row.stage}</span>
        <ChevronRight className="monthly-order-arrow" size={16} aria-hidden="true"/>
      </button></li>;
    })}</ul>
    {list.total > list.pageSize && <ListPagination mobile={mobile} page={list.page} total={list.total}
      loaded={list.items.length} loading={list.loading} onPage={list.setPage} onMore={list.loadMore}/>}
  </Drawer>;
}
