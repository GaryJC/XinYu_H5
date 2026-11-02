import type { DispatchDetail } from '../../../../shared/types';
import { ActionHistory } from '../../shared/ui/ActionHistory';
import { dispatchEventLabel, displayTime } from './dispatchLabels';

export function TechnicianTaskHistory({ detail }: { detail: DispatchDetail }) {
  const { task, events } = detail;
  return <div className="technician-task-history">
    <section aria-label="任务基本信息">
      <h3>任务信息</h3>
      <dl className="technician-history-facts">
        <div><dt>委托单号</dt><dd>{task.orderId}</dd></div>
        <div><dt>接单时间</dt><dd>{displayTime(task.acceptedAt)}</dd></div>
        <div><dt>开工时间</dt><dd>{displayTime(task.firstStartedAt)}</dd></div>
      </dl>
    </section>
    <ActionHistory title="操作记录" items={events.map(event => ({
      key: event.id,
      title: dispatchEventLabel(event),
      actor: event.actorName,
      time: displayTime(event.at),
      detail: <>
        {event.detail.stage ? <p><span className="technician-history-label">任务状态</span>{event.detail.stage}</p> : null}
        {event.action === 'update-due' ? <p><span className="technician-history-label">预计完工</span>{displayTime(event.detail.previousDueAt)} → {displayTime(event.detail.dueAt)}</p> : null}
        {event.detail.reason ? <p><span className="technician-history-label">说明</span>{event.detail.reason}</p> : null}
      </>,
    }))} />
  </div>;
}
