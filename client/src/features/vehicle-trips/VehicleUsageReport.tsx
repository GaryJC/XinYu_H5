import { useEffect, useRef, useState } from 'react';
import { Alert, Button, DatePicker, Empty, Select } from 'antd';
import { ChevronRight } from 'lucide-react';
import dayjs from 'dayjs';
import type { VehicleUsageCount } from '../../../../shared/types';
import { usePagedList } from '../../shared/hooks/usePagedList';
import { ListPagination } from '../../shared/ui/ListPagination';
import { LoadingState } from '../../shared/ui/LoadingState';
import { RefreshButton } from '../../shared/ui/RefreshButton';
import { tripTime } from './tripTime';
import { vehicleTripApi } from './vehicleTripApi';

type ReportProps = { mobile: boolean; busy: boolean; onOpenTrip: (id: string) => void };

type DetailKind = 'usage' | 'missed-returns';
type Selection = { person: VehicleUsageCount; kind: DetailKind };
type UsageSort = 'usage-desc' | 'usage-asc' | 'missed-desc' | 'missed-asc';
const sortOptions: { value: UsageSort; label: string }[] = [
  { value: 'usage-desc', label: '用车次数从多到少' },
  { value: 'usage-asc', label: '用车次数从少到多' },
  { value: 'missed-desc', label: '漏还车次数从多到少' },
  { value: 'missed-asc', label: '漏还车次数从少到多' }
];

function ApplicantTotals({ month, sort, onSelect }: { month: string; sort: UsageSort; onSelect: (selection: Selection) => void }) {
  const [items, setItems] = useState<VehicleUsageCount[]>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    vehicleTripApi.usageSummary(month, controller.signal).then(result => {
      if (!controller.signal.aborted) setItems(result.items);
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '统计加载失败');
    });
    return () => controller.abort();
  }, [month, attempt]);
  if (error) return <Alert type="error" showIcon title={error} action={<Button onClick={() => {
    setError('');
    setAttempt(value => value + 1);
  }}>重试</Button>} />;
  if (!items) return <LoadingState label="正在加载用车统计…" />;
  const field = sort.startsWith('missed-') ? 'missedReturnCount' : 'tripCount';
  const direction = sort.endsWith('-asc') ? 1 : -1;
  const sortedItems = [...items].sort((a, b) => direction * (a[field] - b[field]));
  const trips = items.reduce((sum, person) => sum + person.tripCount, 0);
  const missed = items.reduce((sum, person) => sum + person.missedReturnCount, 0);
  return <>
    <table className="trip-usage-table">
      <thead><tr><th scope="col">用车人</th><th scope="col">用车次数</th><th scope="col">漏还车次数</th></tr></thead>
      <tbody><tr className="trip-usage-total"><th scope="row">本店合计</th><td>{trips}</td><td>{missed}</td></tr>
        {sortedItems.map(person => <tr key={person.applicantId}>
          <th scope="row">{person.applicantName}</th>
          <td><button type="button" aria-label={`查看${person.applicantName}的 ${person.tripCount} 次用车`}
            onClick={() => onSelect({ person, kind: 'usage' })}>{person.tripCount}</button></td>
          <td>{person.missedReturnCount > 0 ? <button type="button" aria-label={`查看${person.applicantName}的 ${person.missedReturnCount} 次漏还车`}
            onClick={() => onSelect({ person, kind: 'missed-returns' })}>{person.missedReturnCount}</button> : 0}</td>
        </tr>)}
      </tbody>
    </table>
    {!items.length && <Empty description="本月暂无用车记录" />}
  </>;
}

function ApplicantTrips({ month, person, kind, mobile, busy, onOpenTrip, onBack, revision }: ReportProps & {
  month: string; person: VehicleUsageCount; kind: DetailKind; onBack: () => void; revision:number;
}) {
  const list = usePagedList(`${month}:${person.applicantId}:${kind}`,
    (page, signal) => vehicleTripApi.reportTrips(month, person.applicantId, kind, page, signal),
    mobile, true, trip => trip.id);
  const lastRevision = useRef(revision);
  useEffect(() => {
    if (lastRevision.current === revision) return;
    lastRevision.current = revision;
    void list.refresh(true);
  }, [revision,list.refresh]);
  return <>
    <header className="trip-report-controls"><h4>{person.applicantName}的{kind === 'usage' ? '用车' : '漏还车'}明细</h4><Button type="link" onClick={onBack}>返回人员统计</Button></header>
    {list.error && <Alert type="error" showIcon title={list.error} action={<Button onClick={() => void list.refresh()}>重试</Button>} />}
    {list.loading && <LoadingState label="正在加载用车明细…" />}
    {!list.error && !list.loading && !list.total && <Empty description="本月暂无对应行程" />}
    <ul className="trip-report-list">{list.items.map(trip => <li key={trip.id}>
      <button type="button" className="trip-report-entry" disabled={busy} aria-label={`查看原单：${trip.vehicle.plate}，${tripTime(trip.departureAt)}`} onClick={() => onOpenTrip(trip.id)}>
        <span className="trip-report-row"><strong>{trip.vehicle.plate}</strong><span>查看原单 <ChevronRight size={16} /></span></span>
        <span className="trip-report-facts"><span>出车时间</span><time dateTime={trip.departureAt}>{tripTime(trip.departureAt)}</time>
          {trip.proxyReturnedBy ? <>
            <span>代登记人</span><span>{trip.proxyReturnedName}</span>
            <span>代登记时间</span><time dateTime={trip.returnAt}>{tripTime(trip.returnAt)}</time>
          </> : <>
            <span>行程状态</span><span>{trip.status}</span>
            {trip.returnAt && <><span>还车时间</span><time dateTime={trip.returnAt}>{tripTime(trip.returnAt)}</time></>}
          </>}
        </span>
      </button>
    </li>)}</ul>
    {list.total > list.pageSize && <ListPagination mobile={mobile} page={list.page} total={list.total} loaded={list.items.length} loading={list.loading} onPage={list.setPage} onMore={list.loadMore} />}
  </>;
}

export function VehicleUsageReport({initialMonth,revision=0,...props}: ReportProps & {initialMonth?:string; revision?:number}) {
  const [month, setMonth] = useState(() => initialMonth ?? new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7));
  const [selection, setSelection] = useState<Selection>();
  const [sort, setSort] = useState<UsageSort>('usage-desc');
  const [refresh, setRefresh] = useState(0);
  return <section className="trip-section trip-report" aria-label="用车统计">
    <div className="trip-report-controls">
      <label htmlFor="vehicle-usage-month">出车月份</label>
      <DatePicker id="vehicle-usage-month" picker="month" format="YYYY年MM月" inputReadOnly allowClear={false} value={dayjs(`${month}-01`)}
        onChange={value => { if (value) { setMonth(value.format('YYYY-MM')); setSelection(undefined); } }} />
      <RefreshButton label="刷新用车统计" onClick={() => setRefresh(n => n + 1)} />
    </div>
    {!selection && <div className="trip-report-controls">
      <label htmlFor="vehicle-usage-sort">排序</label>
      <Select<UsageSort> id="vehicle-usage-sort" value={sort} options={sortOptions} onChange={setSort}
        showSearch={false} style={{ width: 216, maxWidth: '100%' }} />
    </div>}
    {selection ? <ApplicantTrips key={refresh} month={month} revision={revision} {...selection} onBack={() => setSelection(undefined)} {...props} />
      : <ApplicantTotals key={`${month}:${refresh}:${revision}`} month={month} sort={sort} onSelect={setSelection} />}
  </section>;
}
