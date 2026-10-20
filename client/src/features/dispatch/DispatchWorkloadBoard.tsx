import { Button, Empty } from 'antd';
import type { DispatchMetric, TechnicianSummary } from '../../../../shared/types';
import type { DispatchFilters } from './dispatchApi';
import { personDisplayName } from './dispatchLabels';

type WorkloadMetric = DispatchMetric;
const metrics: Array<[DispatchMetric, string, string]> = [
  ['working', '维修中', 'workload-working'],
  ['pendingAccept', '待接单', 'workload-pending'],
  ['paused', '暂停', 'workload-paused'],
  ['inspection', '待检验', 'workload-inspection'],
  ['completed', '已完成', 'workload-completed'],
  ['overdue', '超期', 'workload-overdue'],
  ['rework', '返工', 'workload-rework']
];

export function DispatchWorkloadBoard({ summaries, filters, onSelect }: {
  summaries: TechnicianSummary[];
  filters: DispatchFilters;
  onSelect: (personId: string, metric: WorkloadMetric) => void;
}) {
  const localNow = new Date(Date.now() + 8 * 3600000);
  const month = `${localNow.getUTCFullYear()}-${String(localNow.getUTCMonth() + 1).padStart(2, '0')}`;
  const monthEnd = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const range = `${filters.from || `${month}-01`} 至 ${filters.to || monthEnd}`;

  function metricButton(person: TechnicianSummary, metric: WorkloadMetric, label: string, tone = '') {
    const selected = filters.technicianId === person.id && filters.metric === metric;
    return <Button type="text" className={`workload-metric ${tone} ${person[metric] === 0 ? 'is-zero' : ''} ${selected ? 'is-selected' : ''}`}
      aria-pressed={selected} aria-label={`${personDisplayName(person, summaries)}，${label} ${person[metric]} 单`}
      onClick={() => onSelect(person.id, metric)}>
      <span>{label}</span><strong>{person[metric]}</strong>
    </Button>;
  }

  return <section className="dispatch-workload workload-board" aria-label="工作负荷看板">
    <h3>工作负荷看板 <span>· {summaries.length} 人</span></h3>
      <div className="workload-list">
        {!summaries.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无维修工" /> : summaries.map(person => {
          return <div key={person.id} className={`workload-person ${filters.technicianId === person.id ? 'is-selected-person' : ''}`}>
            <div className="workload-person-name"><strong>{personDisplayName(person, summaries)}</strong>{!person.active ? <span>停用</span> : null}</div>
            <div className="workload-person-metrics">
              {metrics.filter(([metric]) => !['overdue', 'rework'].includes(metric) || person[metric] > 0).map(([metric, label, tone]) =>
                <div key={metric}>{metricButton(person, metric, label, tone)}</div>
              )}
            </div>
            <div className="workload-completion-range">完成量统计：{range}</div>
          </div>;
        })}
      </div>
  </section>;
}
