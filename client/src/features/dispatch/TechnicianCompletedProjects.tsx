import {CompletedProjectFilterBar} from './CompletedProjectFilterBar';
import type { CompletedProjectFilters, UserProfile } from '../../../../shared/types';
import { TechnicianProjectDetail } from './TechnicianProjectDetail';
import { useState } from 'react';
import { Alert, Button, DatePicker, Empty, Grid } from 'antd';
import dayjs from 'dayjs';
import { RefreshCw } from 'lucide-react';
import { usePagedList } from '../../shared/hooks/usePagedList';
import { ListPagination } from '../../shared/ui/ListPagination';
import { LoadingState } from '../../shared/ui/LoadingState';
import { dispatchApi } from './dispatchApi';
import './technician-completed-projects.css';

export function TechnicianCompletedProjects({ user }: { user: UserProfile }) {
  const userId = user.id;
  const [filters,setFilters]=useState<CompletedProjectFilters>({});
  const [selectedOrderId, setSelectedOrderId] = useState<string>();
  const [month, setMonth] = useState(() => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7));
  const mobile = !Grid.useBreakpoint().md;
  const list = usePagedList(`${userId}:${month}:${JSON.stringify(filters)}`, page => dispatchApi.myCompletedProjects(month, page,filters), mobile, true, item => item.key);
  return <section className="completed-projects" aria-label="完工项目核对">
    <div className="completed-projects-toolbar">
      <DatePicker picker="month" value={dayjs(`${month}-01`)} allowClear={false} inputReadOnly aria-label="核对月份" format="YYYY年MM月" onChange={value => { if (value) {setMonth(value.format('YYYY-MM'));setFilters(current=>({sort:current.sort}));} }} />
      <Button icon={<RefreshCw size={16} aria-hidden="true" />} loading={list.loading} onClick={() => void list.refresh()}>刷新</Button>
    </div>
    <CompletedProjectFilterBar filters={filters} setFilters={setFilters}/>
    <div className="completed-projects-total"><span>{user.name} · {filters.from||filters.to?`${filters.from||'不限'} 至 ${filters.to||'不限'}`:dayjs(`${month}-01`).format('YYYY年M月')} · 已完工项目</span><strong>{list.error || list.loading && !list.items.length ? '—' : list.counts?.projects ?? 0}<small> 项</small></strong></div>
    <Alert className="completed-projects-notice" type="info" showIcon role="note" title="仅统计所选时间范围内本人已完工并检验通过项目。" />
    {list.error && <Alert type="error" title={list.error} />}
    {list.loading && <LoadingState label="正在加载维修项目…" />}
    {!list.loading && !list.error && !list.items.length && <Empty description="所选时段暂无已完工项目" />}
    <ol className="completed-projects-list">
      {list.items.map(order => <li key={order.key}>
        <button type="button" className="completed-project-card" aria-label={`查看维修单 ${order.dispatchNo || order.orderId} ${order.plate}`} onClick={() => setSelectedOrderId(order.orderId)}>
          <span className="completed-project-header">
            <span className="completed-project-identifier"><span className="completed-project-number-label">{order.dispatchNo ? '派工号' : '委托单号'}</span><strong>{order.dispatchNo || order.orderId}</strong></span>
            <span className="completed-project-count">{order.projects.length} 项</span>
          </span>
          <span className="completed-project-plate">{order.plate}</span>
          <span className="completed-project-rows">
            {order.projects.map(item => <span className="completed-project-row" key={item.key}>
              <span className="completed-project-name">{item.name}{item.round > 0 && <span className="completed-project-round">第 {item.round} 轮维修</span>}</span>
              <time dateTime={item.completedAt}>{new Date(item.completedAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' })}</time>
            </span>)}
          </span>
        </button>
      </li>)}
    </ol>
    {list.total > 0 && <ListPagination mobile={mobile} page={list.page} total={list.total} loaded={list.items.length} loading={list.loading} onPage={list.setPage} onMore={list.loadMore} />}
    {selectedOrderId && <TechnicianProjectDetail key={selectedOrderId} user={user} orderId={selectedOrderId} onClose={() => { setSelectedOrderId(undefined); void list.refresh(); }}/>}
  </section>;
}
