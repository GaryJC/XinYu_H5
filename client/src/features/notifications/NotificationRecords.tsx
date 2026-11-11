import {RefreshButton} from '../../shared/ui/RefreshButton';
import { Alert, Button, Tag } from 'antd';
import type { NotificationSource } from '../../../../shared/types';
import { ActionHistory } from '../../shared/ui/ActionHistory';
import { LoadingState } from '../../shared/ui/LoadingState';
import { useNotificationRecords } from './useNotificationRecords';
import './notifications.css';

const labels = { pending: '待发送', accepted: '平台已受理', sent: '发送成功', failed: '发送失败', unknown: '结果未知', suppressed: '不推送' };
export function NotificationRecords({ source, resourceId, title = '通知记录', onRetry, retryBusy = false }: {
  source: NotificationSource; resourceId: string; title?: string;
  onRetry?: (id: string) => Promise<unknown>; retryBusy?: boolean;
}) {
  const state = useNotificationRecords(source, resourceId);
  return <details className="notification-records" open={state.open} onToggle={event => {
    if (event.currentTarget.open !== state.open) state.toggle(event.currentTarget.open);
  }}>
    <summary>{title}</summary>
    {state.open ? <div className="notification-records-content">
      <div className="notification-records-toolbar"><p>平台已受理尚未确认送达，需要时可查询结果。</p>
        <RefreshButton size="small" loading={state.loading} disabled={state.busy || retryBusy} onClick={() => void state.load()} label="刷新记录"/>
      </div>
      {state.error ? <Alert showIcon type="error" title={state.error} /> : null}
      {state.refreshError ? <Alert showIcon type="warning" title={state.refreshError} /> : null}
      {state.loading && !state.items.length ? <LoadingState label="正在加载通知记录…" /> : <ActionHistory emptyText="暂无通知记录" items={state.items.map(item => ({
        key: item.id, title: item.kind, actor: item.recipientName,
        time: item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : undefined,
        detail: <>
          <div className="notification-records-actions"><Tag color={item.simulated ? 'default' : item.status === 'sent' ? 'green' : item.status === 'failed' ? 'red' : 'default'}>{item.simulated ? `模拟 · ${labels[item.status]}` : labels[item.status]}</Tag>
            {item.canQuery && ['accepted', 'unknown'].includes(item.status) ? <Button size="small" aria-label={`查询${item.recipientName}的${item.kind}发送结果`} loading={state.queryingId === item.id} disabled={state.busy || retryBusy} onClick={() => void state.query(item.id)}>查询结果</Button> : null}
            {onRetry && item.status === 'failed' && item.canRetry !== false ? <Button size="small" loading={retryBusy} disabled={state.busy || retryBusy} onClick={async () => { if (await onRetry(item.id)) await state.load(); }}>重试通知</Button> : null}
          </div>
          {item.attempts !== undefined ? <p>尝试 {item.attempts} 次</p> : null}
          {item.error ? <p role="status">{item.error}</p> : null}
          {!item.canQuery && item.queryUnavailableReason ? <p className="notification-records-unavailable">{item.queryUnavailableReason}</p> : null}
        </>
      }))} />}
    </div> : null}
  </details>;
}
