import { procurementTotalFen } from "../../../../shared/procurementMoney.mjs";
import { useEffect,useState } from 'react';
import { Alert,Button,Card,Checkbox,Form,Input,InputNumber,Modal,Space,Table } from 'antd';
import type { ProcurementQuote } from '../../../../shared/types';
import { useSupplierPortal } from './useSupplierPortal';
import { ProcurementTermsView } from './ProcurementTenderDetail';
import { ProcurementReportView } from './ProcurementReportView';
import { money,dateTime,statusLabels,localDateTime } from './procurementApi';
import './procurement.css';
export function SupplierPortalPage() {
  const p=useSupplierPortal(),[form]=Form.useForm(),[feedback,setFeedback]=useState('');
  const data=p.data,unitPrice=Form.useWatch('unitPrice',form)||0,freight=Form.useWatch('freight',form)||0;
  const termsVersion=data?.kind==='quote'?data.termsVersion:undefined;
  useEffect(()=>{form.setFieldValue('meetsRequirements',false);},[form,termsVersion]);
  const open=data?.kind==='quote'&&data.status==='open'&&(!data.deadline||Date.parse(data.deadline)>Date.now());
  return <main className="procurement-portal"><div className="procurement">
    <header className="procurement-heading"><div><h1>供应商协作</h1><p className="procurement-muted">配件询价与合作表现</p></div>{data?<Button onClick={p.switchIdentity}>重新核对信息</Button>:null}</header>
    {p.error?<Alert type="error" showIcon role="alert" title={p.error}/>:null}{p.notice?<Alert type="success" showIcon role="status" title={p.notice}/>:null}
    {!data?<Card title="填写供应商信息"><Form layout="vertical" onFinish={v=>p.verify(v.phone,v.identity)}>
      <Form.Item label="预留手机号" name="phone" rules={[{required:true,pattern:/^1\d{10}$/,message:'请输入预留的11位手机号'}]}><Input inputMode="tel" autoComplete="tel"/></Form.Item>
      <Form.Item label="联系人姓名或供应商名称" name="identity" rules={[{required:true,max:100}]}><Input autoComplete="organization"/></Form.Item>
      <Button type="primary" htmlType="submit" loading={p.busy} disabled={!p.token}>进入</Button>
      <p className="procurement-muted">无需加入钉钉企业，无密码、无短信。请使用采购员登记的信息，勿转发专属链接。信息不匹配请联系采购员。</p>
      {!p.token?<Alert type="warning" title="缺少邀请凭证，请打开采购员发送的完整专属链接。"/>:null}
    </Form></Card>:data.kind==='report'?<><ProcurementReportView report={data.report}/><Card title="合作反馈"><Input.TextArea aria-label="合作反馈" placeholder="希望沟通合作价格、部分配件可优惠，或对统计口径有疑问…" maxLength={1000} value={feedback} onChange={e=>setFeedback(e.target.value)} rows={3}/><Button style={{marginTop:12}} type="primary" loading={p.busy} disabled={!feedback.trim()} onClick={()=>void p.feedback(feedback)}>提交反馈</Button></Card></>:<>
      <Card title={`${data.supplierName} · ${data.terms.partName}`} extra={<Button loading={p.busy} onClick={()=>void p.refresh()}>刷新状态</Button>}>
        <Alert type={data.status==='awarded'?'success':'info'} title={`${statusLabels[data.status]} · ${data.result}`} description={`报价截止：${dateTime(data.deadline)}。供应商之间的报价互不可见。`}/>
        {data.quotes[0]&&data.quotes[0].termsVersion!==data.termsVersion?<Alert type="warning" showIcon title="采购要求已修改，请核对最新信息并重新提交报价。原报价暂不参与比价。"/>:null}
        <ProcurementTermsView terms={data.terms} portal/>
      </Card>
      {open?<Card title={data.quotes.length?'修改并重新提交报价':'提交报价'}><Form form={form} layout="vertical" initialValues={{unitPrice:data.quotes[0]?.unitPriceFen?data.quotes[0].unitPriceFen/100:undefined,freight:(data.quotes[0]?.freightFen||0)/100,
        deliveryAt:localDateTime(new Date(data.quotes[0]?.deliveryAt||data.terms.deliveryBy)),note:data.quotes[0]?.note||'',meetsRequirements:false}}
        onFinish={v=>Modal.confirm({title:'确认提交此次报价？',content:`含税含运费总价：${money(procurementTotalFen(Math.round(v.unitPrice*100),data.terms.quantity,Math.round(v.freight*100)))}。截止前可以修改。`,onOk:()=>p.submit({requestId:crypto.randomUUID(),declined:false,unitPriceFen:Math.round(v.unitPrice*100),freightFen:Math.round(v.freight*100),deliveryAt:new Date(v.deliveryAt).toISOString(),meetsRequirements:v.meetsRequirements,note:v.note||''})})}>
        <div className="procurement-form-grid"><Form.Item label="含税单价（元）" name="unitPrice" rules={[{required:true}]}><InputNumber min={0.01} max={100000000} precision={2} style={{width:'100%'}}/></Form.Item>
          <Form.Item label="运费（元）" name="freight" rules={[{required:true}]}><InputNumber min={0} max={100000000} precision={2} style={{width:'100%'}}/></Form.Item>
          <Form.Item label="承诺交货时间（本地时间）" name="deliveryAt" rules={[{required:true}]}><input type="datetime-local"/></Form.Item>
          <Form.Item label="报价备注" name="note"><Input.TextArea maxLength={1000}/></Form.Item></div>
        <div className="procurement-stat">含税含运费总价<strong>{money(procurementTotalFen(Math.round(unitPrice*100),data.terms.quantity,Math.round(freight*100)))}</strong></div>
        <Form.Item name="meetsRequirements" valuePropName="checked" rules={[{validator:(_,v)=>v?Promise.resolve():Promise.reject(new Error('请确认满足采购要求'))}]}><Checkbox>确认满足本次配件规格、品牌、数量、质量及发票付款要求</Checkbox></Form.Item>
        <Space wrap><Button type="primary" htmlType="submit" loading={p.busy}>确认提交报价</Button><Button danger disabled={p.busy} onClick={()=>Modal.confirm({title:'确认放弃本次报价？',content:'结束收集前可以重新报价。',onOk:()=>p.submit({requestId:crypto.randomUUID(),declined:true,note:'主动放弃'})})}>放弃报价</Button></Space>
      </Form></Card>:<Alert type="info" title="报价收集已结束，不能新增或修改报价。"/>}
      <Card title="我的报价记录"><Table<ProcurementQuote> rowKey="id" scroll={{x:550}} dataSource={data.quotes} pagination={false} columns={[{title:'提交时间',dataIndex:'submittedAt',render:dateTime},{title:'报价',render:(_,q)=>q.declined?'主动放弃':money(q.totalFen)},{title:'交货时间',dataIndex:'deliveryAt',render:dateTime},{title:'备注',dataIndex:'note'}]}/></Card>
    </>}
  </div></main>;
}
