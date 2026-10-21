import { Alert, Button, Input, Modal, Space } from 'antd';
import type { WorkOrder } from '../../../../shared/types';
import type { SignatureSession } from './WorkOrderSignatureDialog';
import { useSignatureShare } from './useSignatureShare';
import './customer-signature.css';

export function SignatureShare({ session, onRenew, onUpdated }: {
  session: SignatureSession; onRenew: (session: SignatureSession) => void; onUpdated: (order: WorkOrder) => void;
}) {
  const c = useSignatureShare(session, onRenew, onUpdated);
  return <section className="customer-signature-share" aria-label="客户远程签字链接">
    <strong>客户不在店里？发送链接到客户手机签字</strong>
    <p>无需登录。链接不设时间限制，提交签字或重新生成后失效；客户签字后须由服务顾问或管理员确认。</p>
    <Input aria-label="客户签字链接" readOnly value={c.link} onFocus={event => event.target.select()}/>
    <Space wrap>
      <Button disabled={c.busy} onClick={() => void c.copy()}>复制客户签字链接</Button>
      <Button loading={c.busy} onClick={() => void c.refresh()}>刷新签字状态</Button>
      <Button disabled={c.busy} onClick={() => Modal.confirm({ title: '重新发送客户签字链接？', content: '生成新链接后，旧链接立即失效。请将新链接重新发送给客户。', okText: '生成新链接', cancelText: '取消', onOk: c.renew })}>重新发送链接</Button>
    </Space>
    {c.message && <Alert role="status" type="info" showIcon title={c.message} style={{ marginTop: 8 }}/>}</section>;
}
