import {procurementWinnerIds} from '../../../../shared/procurementWinners.mjs';
import {PurchaseApprovalSheet} from './PurchaseApprovalSheet';
import {useState} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {Alert,Button,Card,Form,Input,InputNumber,Modal,Select,Space,Tag} from 'antd';
import {Printer} from 'lucide-react';
import {hasRole} from '../../../../shared/roles.mjs';
import type {ProcurementTender,UserProfile} from '../../../../shared/types';
import type {ProcurementController} from './useProcurement';
import {money,dateTime} from './procurementApi';
import './purchase-approval.css';
export function ProcurementPurchaseApproval({tender:t,user,controller:c}:{tender:ProcurementTender;user:UserProfile;controller:ProcurementController}) {
 const [form]=Form.useForm(),[reason,setReason]=useState(''),[printing,setPrinting]=useState(false);
 const a=t.purchaseApproval,s=a?.snapshot;
 if(t.status!=='awarded')return null;
 if(procurementWinnerIds(t).length>1&&!a)return <Alert type="info" title="已记录多家中标，实际采购数量及金额线下确定" description="各家报价均基于整单询价数量，不能直接相加作为采购金额。本次不自动生成带金额的采购审批单。"/>;
 const warehouse=hasRole(user,'warehouse'),manager=hasRole(user,'manager');
 const status=a?{pending:'待管理员审批',approved:'已批准',rejected:'已驳回'}[a.status]:'尚未提报';
 const sheet=a?<PurchaseApprovalSheet approval={a} tenderId={t.id}/>:null;
 return <Card title="购买配件审批" extra={<Tag color={a?.status==='approved'?'green':a?.status==='rejected'?'red':'orange'}>{status}</Tag>}>
  {!a||a.status==='rejected'?<>{a?.reason?<Alert type="warning" title={`驳回原因：${a.reason}`}/>:null}{warehouse?<Form form={form} layout="vertical" initialValues={{paymentMethod:s?.paymentMethod||'银行转账',recipientUnit:s?.recipientUnit,contactName:s?.contactName,phone:s?.phone,handlerPhone:s?.handlerPhone,invoice:s?.invoice,note:s?.note||'',customerAmount:s?.customerAmountFen===undefined?undefined:s.customerAmountFen/100}}
   onFinish={values=>Modal.confirm({title:'向门店管理员提报采购审批？',content:'提报后将固定本次明细，等待管理员批准或驳回。',onOk:()=>c.action({...values,action:'submit-approval',expectedVersion:t.version,customerAmountFen:values.customerAmount==null?undefined:Math.round(values.customerAmount*100)})})}>
   <p>中标供应商、配件数量和采购金额由系统带入。</p>
   <Form.Item name="paymentMethod" label="付款方式" rules={[{required:true}]}><Select options={['现金','微信','银行转账'].map(value=>({value,label:value}))}/></Form.Item>
   {([['recipientUnit','接收单位'],['contactName','供货联系人'],['phone','供货联系电话'],['handlerPhone','经办人联系电话'],['invoice','发票情况']] as const).map(([name,label])=><Form.Item key={name} name={name} label={label} rules={[{required:true,whitespace:true,message:`请填写${label}`}]}><Input maxLength={500}/></Form.Item>)}
   <Form.Item name="customerAmount" label="客户金额（元，可选）"><InputNumber min={0} max={1000000000} precision={2}/></Form.Item>
   <Form.Item name="note" label="备注"><Input.TextArea maxLength={500}/></Form.Item>
   <Button type="primary" htmlType="submit" loading={c.busy}>提报管理员审批</Button>
  </Form>:<p>等待仓管填写明细并提报审批。</p>}</>:null}
  {s?<><div className="purchase-sheet-preview">{sheet}</div><Button icon={<Printer size={16}/>} onClick={()=>{flushSync(()=>setPrinting(true));try{window.print();}finally{setPrinting(false);}}}>打印审批单</Button></>:null}
  {a?.status==='pending'&&manager&&a.submittedBy!==user.id?<Space orientation="vertical" style={{width:'100%',marginTop:16}}>
   <Input.TextArea aria-label="采购审批意见" placeholder="审批意见（驳回必填）" maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/>
   <Space><Button type="primary" loading={c.busy} onClick={()=>Modal.confirm({title:'批准本次采购？',content:`${s?.supplierName}，总金额 ${money(s?.totalFen)}`,onOk:()=>c.action({action:'approve-purchase',expectedVersion:t.version,reason})})}>批准采购</Button><Button danger disabled={!reason.trim()} loading={c.busy} onClick={()=>Modal.confirm({title:'驳回本次采购？',content:reason,onOk:()=>c.action({action:'reject-purchase',expectedVersion:t.version,reason})})}>驳回</Button></Space>
  </Space>:null}
  {a?.status==='pending'&&manager&&a.submittedBy===user.id?<p>本人提报的申请须由另一位门店管理员审批。</p>:null}
  {printing?createPortal(<div className="procurement-approval-print">{sheet}</div>,document.body):null}
 </Card>;
}
