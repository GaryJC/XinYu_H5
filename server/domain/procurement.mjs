import { hasAnyRole } from "../../shared/roles.mjs";
import { procurementTotalFen } from "../../shared/procurementMoney.mjs";
import { HttpError } from '../http/HttpError.mjs';
export function procurementAccess(user) {
  if (!user?.active || !hasAnyRole(user, ['manager','warehouse']) || !user.shopId) throw new HttpError(403,'仅本门店管理员和仓管可管理配件竞价');
}
export function text(value, label, max=500, required=true) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new HttpError(400,`${label}格式无效`);
  return value.trim();
}
export function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new HttpError(400,'请求编号格式无效');
  return value;
}
export function instant(value,label) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value))) throw new HttpError(400,`${label}格式无效`);
  return new Date(value).toISOString();
}
export function supplierInput(input) {
  const phone=text(input.phone,'手机号',20).replace(/[\s-]/g,'');
  if(!/^1\d{10}$/.test(phone)) throw new HttpError(400,'请输入11位手机号');
  if(typeof input.active!=='boolean') throw new HttpError(400,'供应商状态无效');
  return {name:text(input.name,'供应商名称',100),contactName:text(input.contactName,'联系人',100),phone,
    categories:text(input.categories??'','主营配件',200,false),note:text(input.note??'','备注',1000,false),active:input.active};
}
export function tenderInput(input,now=Date.now()) {
  const quantity=Number(input.quantity);
  if(!Number.isFinite(quantity)||quantity<=0||quantity>1000000||Math.abs(quantity*1000-Math.round(quantity*1000))>0.00001) throw new HttpError(400,'数量必须大于0，最多三位小数');
  const deadline=input.deadline?instant(input.deadline,'截止时间'):null;
  const deliveryBy=instant(input.deliveryBy,'最晚交货时间');
  if(Date.parse(deliveryBy)<=now||deadline&&(Date.parse(deadline)<=now||Date.parse(deadline)>Date.parse(deliveryBy))) throw new HttpError(400,'交货时间必须在未来，报价截止时间必须早于交货时间');
  if(!Array.isArray(input.supplierIds)||input.supplierIds.length<1||input.supplierIds.length>100||new Set(input.supplierIds).size!==input.supplierIds.length) throw new HttpError(400,'请选择1至100家不同供应商');
  const imageUrls=input.imageUrls??[];
  if(!Array.isArray(imageUrls)||imageUrls.length>5||imageUrls.some(u=>{try{const url=new URL(u);return url.protocol!=='https:'||url.username||url.password||u.length>2000;}catch{return true;}})) throw new HttpError(400,'最多填写5个HTTPS配件图片地址');
  const vin=text(input.vin??'','车架号',17,false).toUpperCase();
  if(vin&&!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))throw new HttpError(400,'请输入17位车架号，不含 I、O、Q');
  const nameplatePhotoIds=input.nameplatePhotoIds??[];
  if(!Array.isArray(nameplatePhotoIds)||nameplatePhotoIds.length>1||new Set(nameplatePhotoIds).size!==nameplatePhotoIds.length||nameplatePhotoIds.some(id=>typeof id!=='string'||!/^file_[A-Za-z0-9_-]+$/.test(id)))throw new HttpError(400,'铭牌照片只能上传1张，且必须为有效照片');
  const otherPhotoIds=input.otherPhotoIds??[];
  if(!Array.isArray(otherPhotoIds)||otherPhotoIds.length>10||new Set(otherPhotoIds).size!==otherPhotoIds.length||otherPhotoIds.some(id=>typeof id!=='string'||!/^file_[A-Za-z0-9_-]+$/.test(id)||nameplatePhotoIds.includes(id)))throw new HttpError(400,'其他照片最多10张，且不能重复');
  return {requestId:uuid(input.requestId),supplierIds:input.supplierIds.map(uuid),deadline,data:{
    partName:text(input.partName,'配件名称',100),vehicleModel:text(input.vehicleModel??'','车辆型号',100,false),vin,nameplatePhotoIds,otherPhotoIds,category:text(input.category??'','配件分类',100,false),
    specification:text(input.specification??'','规格',1000,false),brand:text(input.brand??'','品牌要求',100,false),quantity,unit:text(input.unit,'单位',20),
    deliveryBy,paymentTerms:text(input.paymentTerms,'发票及付款要求',500),
    qualityRequirements:text(input.qualityRequirements??'','质量要求',1000,false),imageUrls}};
}
export function quoteInput(input,terms) {
  const termsVersion=input.termsVersion??1;
  if(!Number.isSafeInteger(termsVersion)||termsVersion<1)throw new HttpError(400,'采购要求版本无效，请刷新页面');
  const result={termsVersion,requestId:uuid(input.requestId),note:text(input.note??'','报价备注',1000,false),declined:input.declined===true};
  if(result.declined) return result;
  for(const key of ['unitPriceFen','freightFen']) if(!Number.isSafeInteger(input[key])||input[key]<0||input[key]>10000000000||(key==='unitPriceFen'&&input[key]===0)) throw new HttpError(400,'请填写有效含税单价和运费');
  const totalFen=procurementTotalFen(input.unitPriceFen,terms.quantity,input.freightFen);
  if(!Number.isSafeInteger(totalFen)||totalFen<=0||totalFen>100000000000) throw new HttpError(400,'报价总额超出范围');
  if(typeof input.meetsRequirements!=='boolean') throw new HttpError(400,'请确认是否满足采购要求');
  return {...result,unitPriceFen:input.unitPriceFen,freightFen:input.freightFen,totalFen,deliveryAt:instant(input.deliveryAt,'承诺交货时间'),meetsRequirements:input.meetsRequirements};
}
export function effectiveStatus(tender,now=Date.now()) {return tender.status==='open'&&tender.deadline&&Date.parse(tender.deadline)<=now?'closed':tender.status;}
export function latestQuote(invitation) {return invitation.quotes[0];}
export function validQuote(tender,invitation) {
  const q=latestQuote(invitation);
  return Boolean(q&&(q.termsVersion??1)===(tender.termsVersion??1)&&!q.declined&&!invitation.invalidReason&&q.meetsRequirements&&Date.parse(q.deliveryAt)<=Date.parse(tender.data.deliveryBy));
}
export function settlement(tender,input) {
  const reason=text(input.reason??'','原因',1000,false);
  if(input.action==='cancel') {if(!['open','closed'].includes(tender.status)) throw new HttpError(409,'询价已经结束');if(!reason) throw new HttpError(400,'取消必须填写原因');return {status:'cancelled',winnerId:null,reason};}
  if(tender.status!=='closed') throw new HttpError(409,'请先结束报价收集');
  const valid=tender.invitations.filter(i=>validQuote(tender,i));
  if(!valid.length) return {status:'failed',winnerId:null,reason:reason||'没有有效报价'};
  const minimum=Math.min(...valid.map(i=>latestQuote(i).totalFen));
  const tied=valid.filter(i=>latestQuote(i).totalFen===minimum);
  const selected=tied.length===1?tied[0]:tied.find(i=>i.supplierId===input.winnerId);
  if(!selected||tied.length>1&&!reason) throw new HttpError(400,'请在并列最低价供应商中选择一家，并填写选择原因');
  return {status:'awarded',winnerId:selected.supplierId,reason};
}
export function dateRange(from,to) {
  const end=to?instant(to,'结束时间'):new Date().toISOString();
  const start=from?instant(from,'开始时间'):new Date(Date.parse(end)-30*86400000).toISOString();
  if(Date.parse(start)>=Date.parse(end)) throw new HttpError(400,'开始时间必须早于结束时间');
  return {from:start,to:end};
}
export function median(values) {if(!values.length)return null;const v=[...values].sort((a,b)=>a-b);return (v[Math.floor((v.length-1)/2)]+v[Math.floor(v.length/2)])/2;}
