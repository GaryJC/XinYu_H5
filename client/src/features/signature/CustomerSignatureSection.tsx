import { Button } from 'antd';
import { FileSignature, Link } from 'lucide-react';
import type { UserProfile, WorkOrder } from '../../../../shared/types';
import { AuthenticatedImage } from '../../shared/ui/AuthenticatedImage';
import { useArchiveSignature } from './useArchiveSignature';
import { WorkOrderSignatureDialog } from './WorkOrderSignatureDialog';
import './signature-section.css';

export function CustomerSignatureSection({order,user,onUpdated}:{order:WorkOrder;user?:UserProfile;onUpdated:(order:WorkOrder)=>void}) {
  const c=useArchiveSignature(user,onUpdated,()=>{});
  return <section className="customer-signature-section" aria-label="客户签名">
    <div className="customer-signature-section-heading"><FileSignature size={20}/><h3>客户签名</h3><span>{order.customerSignatureFileId?'已上传':'待补充'}</span></div>
    {order.customerSignatureFileId?<div className="customer-signature-image"><AuthenticatedImage fileId={order.customerSignatureFileId} width="100%" height={120} alt="客户签名"/></div>:<>
      <p>{order.paperOrder?'纸质委托单也可补充电子签名，发送链接让客户在手机上签署。':'尚未上传客户签名，可生成链接发送给客户签署。'}</p>
      {c.canSign(order)&&<Button icon={<Link size={16}/>} loading={c.starting} onClick={()=>void c.start(order)}>生成签名链接</Button>}
    </>}
    {c.error&&<p className="customer-signature-section-error" role="alert">{c.error}</p>}
    {c.session&&<WorkOrderSignatureDialog key={c.session.token} session={c.session} completeSignature={c.completeSignature} onOrderUpdated={onUpdated} onClose={c.close}/>}
  </section>;
}
