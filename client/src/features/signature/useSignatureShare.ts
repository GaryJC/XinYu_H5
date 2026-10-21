import { useRef, useState } from 'react';
import type { WorkOrder } from '../../../../shared/types';
import { workOrderApi } from '../work-orders/api/workOrderApi';
import { customerSignatureLink } from './customerSignatureApi';
import type { SignatureSession } from './WorkOrderSignatureDialog';

export function useSignatureShare(session: SignatureSession, onRenew: (session: SignatureSession) => void, onUpdated: (order: WorkOrder) => void) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  async function copy() {
    try { await navigator.clipboard.writeText(customerSignatureLink(session.token)); setMessage('链接已复制，请发送给客户。'); }
    catch { setMessage('自动复制不可用，请长按或选中上方链接复制。'); }
  }
  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); setMessage('');
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : '操作失败，请重试'); }
    finally { running.current = false; setBusy(false); }
  }
  function renew() { return run(async () => {
    const order = await workOrderApi.createSignatureToken(session.order.id, session.order.advisor, true);
    if (!order.signatureToken || order.signatureTokenUsed) throw new Error('无法生成新的签字链接，请刷新委托单');
    onRenew({ token: order.signatureToken, order });
    setMessage('新链接已生成，旧链接已失效。请复制新链接并重新发送给客户。');
  }); }
  function refresh() { return run(async () => {
    const order = await workOrderApi.get(session.order.id);
    onUpdated(order);
    setMessage(order.signatures.customer ? '客户已完成签字，需确认用户签字。' : '客户尚未签字。');
  }); }
  return { link: customerSignatureLink(session.token), message, busy, copy, renew, refresh };
}
