import {procurementWinnerIds} from '../../shared/procurementWinners.mjs';
import {hasRole} from '../../shared/roles.mjs';
import {HttpError} from '../http/HttpError.mjs';
const fail=(message,status=409)=>{throw new HttpError(status,message);};
export function purchaseApproval(tender,user,input,now=new Date().toISOString()) {
 if(tender.status!=='awarded')fail('确认中标后才能提报采购审批');
 if(input.expectedVersion!==tender.version)fail('询价或审批已更新，请刷新后重试');
 const previous=tender.purchaseApproval;
 if(input.action==='submit-approval') {
  if(procurementWinnerIds(tender).length>1)fail('多家中标的实际采购数量和金额尚未确定，不能按各家全量报价提报采购审批');
  if(!hasRole(user,'warehouse'))fail('仅仓管可提报采购审批',403);
  if(previous&&!['rejected'].includes(previous.status))fail('已提报或已批准，不能重复提报');
  const field=(key,label,required=true)=>{const value=input[key];if(typeof value!=='string'||value.length>500||required&&!value.trim())fail(`请填写有效的${label}`,400);return value.trim();};
  const paymentMethod=field('paymentMethod','付款方式');if(!['现金','微信','银行转账'].includes(paymentMethod))fail('付款方式无效',400);
  const customerAmountFen=input.customerAmountFen;
  if(customerAmountFen!==undefined&&(!Number.isSafeInteger(customerAmountFen)||customerAmountFen<0||customerAmountFen>100000000000))fail('客户金额无效',400);
  const winner=tender.invitations.find(i=>i.supplierId===tender.winnerId),quote=winner?.quotes[0];
  if(!quote||quote.declined||quote.termsVersion!==tender.termsVersion||winner.invalidReason||!Number.isSafeInteger(quote.totalFen))fail('中标报价无效，请核对');
  return {status:'pending',submittedBy:user.id,submittedName:user.name,submittedAt:now,snapshot:{
   paymentMethod,purchaseDate:new Date(now).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}),supplierName:winner.supplierName,contactName:field('contactName','联系人'),phone:field('phone','联系电话'),
   handlerPhone:field('handlerPhone','经办人联系电话'),invoice:field('invoice','发票情况'),recipientUnit:field('recipientUnit','接收单位'),note:field('note','备注',false),
   partName:tender.data.partName,specification:tender.data.specification,quantity:tender.data.quantity,unit:tender.data.unit,
   unitPriceFen:quote.unitPriceFen,freightFen:quote.freightFen,totalFen:quote.totalFen,...(customerAmountFen===undefined?{}:{customerAmountFen})}};
 }
 if(!hasRole(user,'manager'))fail('仅门店管理员可审批',403);
 if(previous?.status!=='pending')fail('申请不在待审批状态');
 if(previous.submittedBy===user.id)fail('不能审批本人提报的申请',403);
 if(!['approve-purchase','reject-purchase'].includes(input.action))fail('审批操作无效',400);
 const reason=typeof input.reason==='string'?input.reason.trim():'';
 if(reason.length>1000||input.action==='reject-purchase'&&!reason)fail('驳回须填写原因，最多1000字',400);
 return {...previous,status:input.action==='approve-purchase'?'approved':'rejected',reviewedBy:user.id,reviewedName:user.name,reviewedAt:now,reason};
}
