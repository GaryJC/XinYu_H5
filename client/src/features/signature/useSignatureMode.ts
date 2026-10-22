import { useRef, useState } from 'react';
import type { CustomerSignatureMode, WorkOrder } from '../../../../shared/types';
import { workOrderApi } from '../work-orders/api/workOrderApi';
import type { SignatureSession } from './WorkOrderSignatureDialog';

export function useSignatureMode(session: SignatureSession, onSession: (session: SignatureSession) => void, onUpdated: (order: WorkOrder) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const mode: CustomerSignatureMode = session.order.status === '草稿' ? 'onsite' : 'remote';
  async function change(next: CustomerSignatureMode) {
    if (running.current || next === mode) return;
    running.current = true; setBusy(true); setError('');
    try {
      const order = await workOrderApi.createSignatureToken(session.order.id, session.order.advisor, false, next);
      if (!order.signatureToken) throw new Error('签字会话已失效，请重新发起签字');
      onSession({ token: order.signatureToken, order });
      onUpdated(order);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '切换签字方式失败'); }
    finally { running.current = false; setBusy(false); }
  }
  return { mode, busy, error, change };
}
