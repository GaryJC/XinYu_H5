import { Tag } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import type { ProcurementDelivery } from '../../../../shared/types';
import { dateTime, notificationLabel } from './procurementApi';

export function ProcurementNotifications({notifications}:{notifications:ProcurementDelivery[]}) {
  const batches = new Map<string, ProcurementDelivery[]>();
  for (const notification of notifications) {
    const key=notification.batchId||notification.id;
    const recipients=batches.get(key)||[];
    recipients.push(notification);
    batches.set(key,recipients);
  }
  return <section className="procurement-notifications" aria-label="通知状态">
    <h3><BellOutlined aria-hidden/>通知状态</h3>
    {batches.size ? <div className="procurement-notification-batches">{[...batches].map(([key,recipients])=>{
      const first=recipients[0];
      return <article className="procurement-notification-batch" key={key}>
        <header><strong>{first.title||'业务通知'}</strong>{first.createdAt?<time dateTime={first.createdAt}>发起于 {dateTime(first.createdAt)}</time>:null}</header>
        <ul className="procurement-notification-recipients" aria-label="本次通知接收人">{recipients.map(n=><li key={n.id}>
          <div><span>{n.recipientName}</span><Tag color={n.simulated?'default':n.status==='sent'?'success':n.status==='failed'?'error':'processing'}>{n.simulated?(n.status==='sent'?'模拟发送':`模拟 · ${notificationLabel(n.status)}`):notificationLabel(n.status)}</Tag></div>
          {n.error?<p role={n.status==='failed'?'alert':undefined}>{n.error}</p>:null}
        </li>)}</ul>
      </article>;
    })}</div>:<p className="procurement-muted">暂无通知</p>}
    {notifications.some(n=>n.simulated)?<p className="procurement-notification-note">模拟通知仅用于测试，未实际发送钉钉消息。</p>:null}
  </section>;
}
