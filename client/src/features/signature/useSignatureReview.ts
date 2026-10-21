import { useRef, useState } from 'react';
import type { WorkOrder } from '../../../../shared/types';
import { customerSignatureLink } from './customerSignatureApi';
import { workOrderApi } from '../work-orders/api/workOrderApi';

export function useSignatureReview(order: WorkOrder, onUpdated: (order: WorkOrder) => void) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [renewedLink,setLink]=useState<{orderId:string;url:string}>();
  const running = useRef(false);
  async function confirm() {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    try { onUpdated(await workOrderApi.confirmCustomerSignature(order.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '确认失败，请重试'); }
    finally { running.current = false; setBusy(false); }
  }
  async function resign() {
    if(running.current)return;
    running.current=true;setBusy(true);setError('');
    try {
      const updated=await workOrderApi.createSignatureToken(order.id,order.advisor,true);
      if(!updated.signatureToken)throw new Error('未生成签字链接，请重试');
      setLink({orderId:order.id,url:customerSignatureLink(updated.signatureToken)});
      onUpdated(updated);
    } catch(reason){setError(reason instanceof Error?reason.message:'重新发起失败');}
    finally{running.current=false;setBusy(false);}
  }
  return { busy, error, confirm, resign, link: renewedLink?.orderId === order.id ? renewedLink.url : undefined };
}
