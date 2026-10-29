import type { Key, ReactNode } from 'react';
import { Clock3 } from 'lucide-react';
import './action-history.css';

export type ActionHistoryItem = {
  key: Key;
  title: ReactNode;
  actor?: ReactNode;
  time?: ReactNode;
  dateTime?: string;
  detail?: ReactNode;
};

/** Presentation only: callers retain their ordering, labels and time formatting. */
export function ActionHistory({ title, items, emptyText = '暂无记录', children }: {
  title?: string;
  items: ActionHistoryItem[];
  emptyText?: string;
  children?: ReactNode;
}) {
  return <section className="action-history" aria-label={title || '操作记录'}>
    {title ? <h3 className="action-history-heading"><Clock3 size={18} aria-hidden="true" />{title}</h3> : null}
    {items.length ? <ol className="action-history-list">{items.map(item => <li className="action-history-item" key={item.key}>
      <div className="action-history-summary"><strong>{item.title}</strong>{item.actor ? <span className="action-history-actor">{item.actor}</span> : null}</div>
      {item.time ? <time className="action-history-time" dateTime={item.dateTime}>{item.time}</time> : null}
      {item.detail ? <div className="action-history-detail">{item.detail}</div> : null}
    </li>)}</ol> : <p className="action-history-empty">{emptyText}</p>}
    {children ? <div className="action-history-note">{children}</div> : null}
  </section>;
}
