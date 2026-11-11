import type { NotificationDelivery, NotificationQueryResult, NotificationSource } from '../../../../shared/types';
import { request } from '../../shared/api/httpClient';

export const notificationApi = {
  list: (source: NotificationSource, resourceId: string, signal?: AbortSignal) => request<NotificationDelivery[]>(
    `/api/notifications?${new URLSearchParams({ source, resourceId })}`, { signal }
  ),
  query: (source: NotificationSource, id: string) => request<NotificationQueryResult>(
    `/api/notifications/${encodeURIComponent(source)}/${encodeURIComponent(id)}/query`, { method: 'POST' }
  )
};
