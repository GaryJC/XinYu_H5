import { Alert, Button, Modal } from 'antd';
import type { UserProfile, WorkOrder } from '../../../../shared/types';
import { AuthenticatedImage } from '../../shared/ui/AuthenticatedImage';
import { useSignatureReview } from './useSignatureReview';

export function SignatureReview({ order, user, onUpdated }: { order: WorkOrder; user?: UserProfile; onUpdated: (order: WorkOrder) => void }) {
  const c = useSignatureReview(order, onUpdated);
  if (order.customerSignatureReview?.state !== 'pending') return null;
  const canConfirm = user?.active && user.shopId === order.shop.id && (user.role === 'manager' || user.role === 'advisor' && user.name === order.advisor);
  return <section aria-label="客户签字确认" style={{ marginBottom: 16 }}>
    <Alert type="warning" showIcon title="需确认用户签字" description="客户已签字。核对签名并确认后，才会提交润丰同步并进入后续派工流程。"/>
    {order.customerSignatureFileId && <div style={{ margin: '12px 0' }}><AuthenticatedImage fileId={order.customerSignatureFileId} width={240} height={110} alt="待确认的客户签名"/></div>}
    {c.error && <Alert type="error" role="alert" title={c.error}/>}
    {canConfirm && <Button type="primary" loading={c.busy} onClick={() => Modal.confirm({ title: '确认客户签名并继续流程？', content: '请核对以上客户签名。确认后将提交润丰同步，并执行预设派工。', okText: '确认用户签字', cancelText: '取消', onOk: c.confirm })}>确认用户签字</Button>}
  </section>;
}
