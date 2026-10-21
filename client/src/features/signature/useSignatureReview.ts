import { useRef, useState } from 'react';
import type { WorkOrder } from '../../../../shared/types';
import { workOrderApi } from '../work-orders/api/workOrderApi';

export function useSignatureReview(order: WorkOrder, onUpdated: (order: WorkOrder) => void) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const running = useRef(false);
  async function confirm() {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    try { onUpdated(await workOrderApi.confirmCustomerSignature(order.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '确认失败，请重试'); }
    finally { running.current = false; setBusy(false); }
  }
  return { busy, error, confirm };
}
