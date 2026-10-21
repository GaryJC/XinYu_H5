import { Alert, Button, Card, Checkbox, Spin } from 'antd';
import { SignaturePad } from './SignaturePad';
import { useCustomerSignature } from './useCustomerSignature';
import './customer-signature.css';

export function CustomerSignaturePage() {
  const c = useCustomerSignature();
  const order = c.session?.state === 'pending' ? c.session.order : undefined;
  return <main className="customer-signature-page"><Card className="signature-panel" title="机动车维修委托确认">
    {c.loading ? <Spin description="正在加载委托信息…"/> : c.session?.state === 'signed'
      ? <Alert type="success" showIcon role="status" title="签字已提交" description="服务顾问或管理员确认后将安排后续流程，您可以关闭此页面。"/>
      : <>
        {c.error && <Alert type="error" showIcon role="alert" title={c.error}/>}
        {order && <>
          <p>请核对以下委托信息，确认后在下方手写签名。</p>
          <dl className="customer-signature-details">
            <dt>门店</dt><dd>{order.shop.name}</dd>
            <dt>委托单号</dt><dd>{order.id}</dd>
            <dt>车牌号码</dt><dd>{order.vehicle.plate}</dd>
            <dt>车主名称/所属单位</dt><dd>{order.customerName}</dd>
            <dt>车型 / 进厂里程</dt><dd>{order.vehicle.model} / {order.vehicle.mileage} 公里</dd>
            <dt>故障描述</dt><dd>{order.faultDescription || '—'}</dd>
            <dt>预计费用</dt><dd>¥{order.estimatedFee.toFixed(2)}</dd>
            <dt>费用说明</dt><dd>{order.feeNote || '—'}</dd>
            <dt>旧件处置</dt><dd>{order.oldPartsHandling}</dd>
            <dt>预计交车</dt><dd>{order.estimatedDeliveryAt || '待沟通'}</dd>
          </dl>
          <h2>维修项目</h2>
          <div className="public-items">{order.repairItems.map((item, i) => <div key={i}><span>{item.name}</span><strong>¥{item.laborFee.toFixed(2)}</strong></div>)}</div>
          <p className="signature-field-label">电子签名 <Button type="link" disabled={c.busy} onClick={() => c.setLandscape(true)}>横屏签字</Button></p>
          <SignaturePad value={c.image} onChange={c.setImage} disabled={c.busy}/>
          <Checkbox checked={c.confirmed} disabled={c.busy} onChange={event => c.setConfirmed(event.target.checked)}>我已核对以上委托信息，并确认提交本人签名。</Checkbox>
          <Button block size="large" type="primary" loading={c.busy} disabled={!c.image || !c.confirmed} onClick={() => void c.submit()}>确认签字并提交</Button>
          <p className="customer-signature-help">链接有效期至 {new Date(c.session?.state === 'pending' ? c.session.expiresAt : '').toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间），请勿转发。信息有误请联系服务顾问。</p>
        </>}
      </>}
  </Card>
    {c.landscape && order && <div className="signature-landscape-overlay" role="dialog" aria-modal="true" aria-label="横屏签字">
      <div className="signature-landscape-header"><div><strong>请客户横向签名</strong><span>{order.vehicle.plate} · {order.customerName}</span></div><Button type="primary" onClick={() => c.setLandscape(false)}>完成横屏签字</Button></div>
      <SignaturePad landscapeMode value={c.image} onChange={c.setImage} disabled={c.busy}/>
    </div>}
  </main>;
}
