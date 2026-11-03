import type { DispatchItem } from '../../../../shared/types';
import { displayTaskTime, displayTime } from './dispatchLabels';

export function RepairItemProgress({ item }: { item: DispatchItem }) {
  const records = [
    { label: '开工', at: item.startAt },
    { label: '完工提报', at: item.finishAt },
    { label: '检验', at: item.inspectedAt, person: item.inspectorName },
    { label: '领料确认', at: item.pickedAt }
  ];
  return <div className="repair-item-progress" aria-label={`${item.name}进度记录`}>
    <dl className="repair-progress-records">{records.map(record => <div key={record.label}>
      <dt>{record.label}</dt>
      <dd>{record.person && <span>{record.person}</span>}{record.at
        ? <time dateTime={record.at} title={displayTime(record.at)}>{displayTaskTime(record.at)}</time>
        : <span className="repair-progress-unrecorded">{record.person ? '时间未记录' : '未记录'}</span>}</dd>
    </div>)}</dl>
  </div>;
}
