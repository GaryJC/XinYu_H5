import type {ProcurementPurchaseApproval} from '../../../../shared/types';
import {money,dateTime} from './procurementApi';
export function PurchaseApprovalSheet({approval:a,tenderId}:{approval:ProcurementPurchaseApproval;tenderId:string}) {
 const s=a.snapshot,status={pending:'待管理员审批',approved:'已批准',rejected:'已驳回'}[a.status];
 return <div className="purchase-approval-sheet">
   <h2>{s.paymentMethod}购买配件审批单</h2><p>询价编号：{tenderId}　审批状态：{status}</p>
   <table><thead><tr>{['购买日期','接收单位','供货单位','联系人','联系电话','发票情况','配件名称／规格','数量','单价','金额','客户金额','备注'].map(v=><th key={v}>{v}</th>)}</tr></thead>
   <tbody><tr><td>{s.purchaseDate}</td><td>{s.recipientUnit}</td><td>{s.supplierName}</td><td>{s.contactName}</td><td>{s.phone}</td><td>{s.invoice}</td><td>{s.partName}<br/>{s.specification}</td><td>{s.quantity} {s.unit}</td><td>{money(s.unitPriceFen)}</td><td>{money(s.totalFen)}</td><td>{s.customerAmountFen===undefined?'—':money(s.customerAmountFen)}</td><td>{s.note||'—'}</td></tr>
   <tr><td colSpan={9}>合计（含税、含运费；运费 {money(s.freightFen)}）</td><td>{money(s.totalFen)}</td><td colSpan={2}/></tr></tbody></table>
   <p>经办人及联系方式：{a.submittedName}　{s.handlerPhone}</p>
   <div className="purchase-signatures"><span>申请人：{a.submittedName}</span><span>审核人：{a.reviewedName||'待审批'}</span><span>负责人签字：____________</span></div>
   <p>提报时间：{dateTime(a.submittedAt)}　{a.reviewedAt?`审批时间：${dateTime(a.reviewedAt)}`:''}</p>
   {a.reason?<p>审批意见：{a.reason}</p>:null}
   <p>说明：本单金额来自最终中标报价。系统审批结果及操作记录可在询价详情核验；本单不代表付款完成。</p>
 </div>;
}
