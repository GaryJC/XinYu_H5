import { useRef } from "react";
import { Button,Checkbox,Form,Input,InputNumber,Select,Space } from 'antd';
import type { ProcurementSupplier,ProcurementSupplierInput,ProcurementCreateInput,ProcurementTender } from '../../../../shared/types';
import { localDateTime } from './procurementApi';
export function SupplierForm({supplier,busy,onSave,onCancel}:{supplier?:ProcurementSupplier;busy:boolean;onSave:(body:ProcurementSupplierInput)=>Promise<void>;onCancel:()=>void}) {
  return <Form layout="vertical" initialValues={supplier||{active:true,categories:'',note:''}} onFinish={onSave}>
    <Form.Item name="name" label="供应商名称" rules={[{required:true,max:100}]}><Input autoComplete="organization"/></Form.Item>
    <Form.Item name="contactName" label="联系人姓名" rules={[{required:true,max:100}]}><Input autoComplete="name"/></Form.Item>
    <Form.Item name="phone" label="预留手机号" rules={[{required:true,pattern:/^1\d{10}$/,message:'请输入11位手机号'}]}><Input inputMode="tel" autoComplete="tel"/></Form.Item>
    <Form.Item name="categories" label="主营配件"><Input maxLength={200}/></Form.Item><Form.Item name="note" label="内部备注"><Input.TextArea maxLength={1000}/></Form.Item>
    <Form.Item name="active" valuePropName="checked"><Checkbox>启用供应商</Checkbox></Form.Item>
    <Space><Button type="primary" htmlType="submit" loading={busy}>保存供应商</Button><Button onClick={onCancel}>取消</Button></Space>
  </Form>;
}
export function TenderForm({suppliers,busy,onSave,onCancel,tender}:{suppliers:ProcurementSupplier[];tender?:ProcurementTender;busy:boolean;onSave:(body:ProcurementCreateInput)=>Promise<void>;onCancel:()=>void}) {
  const request=useRef({fingerprint:'',id:''});
  const [form]=Form.useForm();const hasDeadline=Form.useWatch('hasDeadline',form);
  return <Form form={form} layout="vertical" initialValues={{quantity:1,unit:'件',brand:'不限品牌，须满足规格',paymentTerms:'含税报价，提供发票；付款方式由采购员确认',qualityRequirements:'',imageUrls:'',hasDeadline:true,
    deliveryBy:localDateTime(new Date(Date.now()+3*86400000)),deadline:localDateTime(new Date(Date.now()+86400000)),
    ...(tender?{...tender.data,imageUrls:tender.data.imageUrls.join('\n'),deliveryBy:localDateTime(new Date(tender.data.deliveryBy)),deadline:tender.deadline?localDateTime(new Date(tender.deadline)):undefined,hasDeadline:!!tender.deadline}:{})}}
    onFinish={async v=>{const body={...v,deliveryBy:tender&&v.deliveryBy===localDateTime(new Date(tender.data.deliveryBy))?tender.data.deliveryBy:new Date(v.deliveryBy).toISOString(),deadline:v.hasDeadline?(tender?.deadline&&v.deadline===localDateTime(new Date(tender.deadline))?tender.deadline:new Date(v.deadline).toISOString()):null,supplierIds:tender?tender.invitations.map(i=>i.supplierId):v.supplierIds,imageUrls:String(v.imageUrls||'').split('\n').map(s=>s.trim()).filter(Boolean)};
      const fingerprint=JSON.stringify(body);if(request.current.fingerprint!==fingerprint)request.current={fingerprint,id:crypto.randomUUID()};
      await onSave({...body,requestId:request.current.id});}}>

    <div className="procurement-form-grid">
      <Form.Item name="partName" label="配件名称" rules={[{required:true,max:100}]}><Input/></Form.Item>
      <Form.Item name="category" label="配件分类" rules={[{required:true,max:100}]}><Input placeholder="如：制动系统"/></Form.Item>
      <Form.Item className="procurement-wide" name="specification" label="型号 / 配件编码 / 规格" rules={[{required:true,max:1000}]}><Input.TextArea rows={2}/></Form.Item>
      <Form.Item name="brand" label="品牌要求" rules={[{required:true,max:100}]}><Input/></Form.Item>
      <Form.Item name="quantity" label="数量" rules={[{required:true}]}><InputNumber min={0.001} max={1000000} precision={3} style={{width:'100%'}}/></Form.Item>
      <Form.Item name="unit" label="单位" rules={[{required:true,max:20}]}><Input/></Form.Item>
      <Form.Item name="deliveryBy" label="最晚交货时间（本地时间）" rules={[{required:true}]}><input type="datetime-local"/></Form.Item>
      <Form.Item className="procurement-wide" name="paymentTerms" label="发票及付款要求" rules={[{required:true,max:500}]}><Input.TextArea rows={2}/></Form.Item>
      <Form.Item className="procurement-wide" name="qualityRequirements" label="质量要求"><Input.TextArea maxLength={1000}/></Form.Item>
      <Form.Item className="procurement-wide" name="imageUrls" label="配件参考图片地址（HTTPS，每行一个，最多5个）"><Input.TextArea rows={2}/></Form.Item>
      {!tender?<Form.Item className="procurement-wide" name="supplierIds" label="受邀供应商" rules={[{required:true,message:'请至少选择一家供应商'}]}><Select mode="multiple" optionFilterProp="label" options={suppliers.filter(s=>s.active).map(s=>({value:s.id,label:s.name}))}/></Form.Item>:null}
      <Form.Item name="hasDeadline" valuePropName="checked"><Checkbox>设置报价截止时间</Checkbox></Form.Item>
      {hasDeadline?<Form.Item name="deadline" label="报价截止时间（本地时间）" rules={[{required:true}]}><input type="datetime-local"/></Form.Item>:<p className="procurement-muted">无截止时间，由管理员或仓管手动结束报价。</p>}
    </div>
    <p className="procurement-muted">每次只询价一种配件，邀请名单发布后固定。截止时间可调整；修改采购要求后，供应商须按新要求重新确认报价。</p>
    <Space><Button type="primary" htmlType="submit" loading={busy}>{tender?'保存修改':'发布询价并生成链接'}</Button><Button onClick={onCancel}>取消</Button></Space>
  </Form>;
}
