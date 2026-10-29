import { request } from '../../shared/api/httpClient';
import type { ProcurementSupplier,ProcurementSupplierInput,ProcurementTender,ProcurementCreateInput,ProcurementDetail,ProcurementLink,ProcurementAnalytics,ProcurementReportRecord,ProcurementAudit,ProcurementPortal,ProcurementQuoteInput } from '../../../../shared/types';
const root='/api/procurement';
export const procurementApi={
  uploadPhoto:(body:{imageBase64:string;mimeType:string;fileName?:string;requestId:string})=>request<{id:string}>(`${root}/photos`,{method:'POST',body}),
  suppliers:()=>request<ProcurementSupplier[]>(`${root}/suppliers`),
  saveSupplier:(input:ProcurementSupplierInput,id?:string)=>request<ProcurementSupplier>(`${root}/suppliers${id?`/${id}`:''}`,{method:id?'PUT':'POST',body:input}),
  tenders:()=>request<ProcurementTender[]>(`${root}/tenders`),
  create:(input:ProcurementCreateInput)=>request<{tender:ProcurementTender;links:ProcurementLink[]}>(`${root}/tenders`,{method:'POST',body:input}),
  detail:(id:string)=>request<ProcurementDetail>(`${root}/tenders/${id}`),
  action:(id:string,body:Record<string,unknown>)=>request<ProcurementDetail&{link?:ProcurementLink|null}>(`${root}/tenders/${id}/actions`,{method:'POST',body}),
  analytics:(from:string,to:string,category?:string)=>request<ProcurementAnalytics>(`${root}/analytics?${new URLSearchParams({from,to,...(category?{category}:{})})}`),
  reports:()=>request<ProcurementReportRecord[]>(`${root}/reports`),
  createReport:(body:{supplierId:string;from:string;to:string;note:string})=>request<ProcurementReportRecord>(`${root}/reports`,{method:'POST',body}),
  report:(id:string)=>request<ProcurementReportRecord&{activity:ProcurementAudit[]}>(`${root}/reports/${id}`),
  reportAction:(id:string,action:'publish'|'revoke')=>request<{link:ProcurementLink|null}>(`${root}/reports/${id}/actions`,{method:'POST',body:{action}}),
};
export const supplierPortalApi={
  resume:(token:string)=>request<ProcurementPortal>('/api/supplier-portal/resume',{method:'POST',skipAuth:true,body:{token}}),
  verify:(token:string,phone:string,identity:string)=>request<{ok:boolean}>('/api/supplier-portal/verify',{method:'POST',skipAuth:true,body:{token,phone,identity}}),
  me:()=>request<ProcurementPortal>('/api/supplier-portal/me',{skipAuth:true}),
  quote:(body:ProcurementQuoteInput&{invitationId:string})=>request<{ok:boolean}>('/api/supplier-portal/quote',{method:'POST',skipAuth:true,body}),
  feedback:(reportId:string,feedback:string)=>request<{ok:boolean}>('/api/supplier-portal/feedback',{method:'POST',skipAuth:true,body:{reportId,feedback}}),
};
export function publicLink(token:string) {return `${location.origin}/supplier#${encodeURIComponent(token)}`;}
export const money=(fen:number|undefined)=>fen===undefined?'—':new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}).format(fen/100);
export const dateTime=(iso:string|null|undefined)=>iso?new Date(iso).toLocaleString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'}):'未设置';
export const statusLabels:Record<ProcurementTender['status'],string>={open:'报价中',closed:'待结标',awarded:'已中标',failed:'已流标',cancelled:'已取消'};
export function localDateTime(date:Date) {const p=(n:number)=>String(n).padStart(2,'0');return `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;}

const notificationLabels:Record<string,string>={pending:'等待发送',ready:'已排队',accepted:'平台已受理',sent:'已发送',failed:'发送失败',unknown:'待核实'};
export const notificationLabel=(status:string)=>notificationLabels[status]||status;

// Older audit records store action codes; keep their presentation readable.
export function procurementAuditLabel(action:string) {
  const labels:Record<string,string>={close:'结束报价收集',settle:'确认结标',cancel:'取消询价',update:'修改询价',invalidate:'处理报价有效性','reissue-link':'重发邀请链接','revoke-link':'撤销邀请链接'};
  return labels[action]||action;
}
