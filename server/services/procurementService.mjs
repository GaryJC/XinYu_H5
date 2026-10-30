import {procurementWinnerIds} from '../../shared/procurementWinners.mjs';
import {purchaseApproval} from '../domain/procurementApproval.mjs';
import {assertProcurementPhotos} from '../repositories/procurementPhotoRepository.mjs';
import { isDeepStrictEqual } from "node:util";
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { pool,transaction } from '../database/pool.mjs';
import { HttpError } from '../http/HttpError.mjs';
import * as repo from '../repositories/procurementRepository.mjs';
import { procurementAccess,supplierInput,tenderInput,quoteInput,uuid,text,settlement,dateRange,effectiveStatus } from '../domain/procurement.mjs';
import { analyze,supplierReport } from './procurementAnalytics.mjs';
export const hashToken=value=>createHash('sha256').update(value).digest('hex');
const iso=value=>new Date(value).toISOString();
const missing=()=>new HttpError(404,'记录不存在或不属于本门店');
const same=isDeepStrictEqual;
async function actor(user,db) {const fresh=await repo.currentActor(user,db);procurementAccess(fresh);if(fresh.shopId!==user.shopId)throw new HttpError(403,'门店权限已变更，请重新登录');return fresh;}
async function ownedTender(user,id,db) {const row=await repo.lockTender(uuid(id),db);if(!row||row.shop_id!==user.shopId)throw missing();await repo.freezeDue(db,id);return (await repo.readTenders(user.shopId,{id},db))[0];}
async function newLink(db,{invitationId,reportId,tenderId,supplierName,readOnly=false}) {
  const token=randomBytes(32).toString('base64url'),expiresAt=new Date(Date.now()+(reportId||readOnly?30:90)*86400000).toISOString();
  await repo.saveLink(db,{id:randomUUID(),invitationId,reportId,tenderId,hash:hashToken(token),expiresAt,token});return {supplierName,token,expiresAt};
}
export async function listSuppliers(user) {procurementAccess(user);return repo.suppliers(user.shopId);}
export async function updateSupplier(user,id,body) {
  procurementAccess(user);const input=supplierInput(body),supplierId=id?uuid(id):randomUUID();
  return transaction(async db=>{await actor(user,db);if(id&&!await repo.supplierById(user.shopId,id,db))throw missing();
    try {const saved=await repo.saveSupplier(user.shopId,supplierId,input,db);await repo.audit(db,{shopId:user.shopId,supplierId,actor:user.name,action:id?'更新供应商':'新增供应商'});return saved;}
    catch(error){if(error.code==='23505')throw new HttpError(409,'本门店已存在同名供应商');throw error;}});
}
export async function listTenders(user,query={}) {procurementAccess(user);return query.page===undefined?repo.readTenders(user.shopId):repo.readTenderPage(user.shopId,query);}
export async function tenderDetail(user,id) {procurementAccess(user);const result=await repo.detail(user.shopId,uuid(id));if(!result)throw missing();return result;}
export async function publishTender(user,body) {
  procurementAccess(user);const input=tenderInput(body);
  return transaction(async db=>{await actor(user,db);await assertProcurementPhotos(db,user.shopId,[...input.data.nameplatePhotoIds,...input.data.otherPhotoIds]);const id=randomUUID();const saved=await repo.createTender(db,user,id,input);
    if(!saved){const prior=await repo.tenderRequest(db,user,input.requestId);if(!same(prior.request_body,input))throw new HttpError(409,'请求编号已被其他内容使用');return {tender:(await repo.readTenders(user.shopId,{id:prior.id},db))[0],links:[]};}
    const links=[];
    for(const supplierId of [...input.supplierIds].sort()) {
      const s=await repo.supplierById(user.shopId,supplierId,db);if(!s?.active)throw new HttpError(400,'受邀供应商不存在、已停用或不属于本门店');
      const inv=await repo.addInvitation(db,id,s);links.push(await newLink(db,{invitationId:inv.id,supplierName:s.name}));
    }
    await repo.audit(db,{shopId:user.shopId,tenderId:id,actor:user.name,action:'发布询价',detail:{supplierCount:links.length}});
    await repo.notificationFanout(db,{shopId:user.shopId,tenderId:id,title:`配件询价已发布：${input.data.partName}`});
    const sharedLink=await newLink(db,{tenderId:id,supplierName:'本次询价全部受邀供应商'});
    return {tender:(await repo.readTenders(user.shopId,{id},db))[0],links,sharedLink};});
}
export async function tenderAction(user,id,body) {
  procurementAccess(user);
  return transaction(async db=>{const fresh=await actor(user,db);const tender=await ownedTender(user,id,db);
    if(['submit-approval','approve-purchase','reject-purchase'].includes(body.action)) {
      const approval=purchaseApproval(tender,fresh,body);
      await repo.savePurchaseApproval(db,id,approval);
      const label={'submit-approval':'采购提报审批','approve-purchase':'采购审批通过','reject-purchase':'采购审批驳回'}[body.action];
      await repo.audit(db,{shopId:user.shopId,tenderId:id,actor:fresh.name,action:label,detail:{approval,previousApproval:tender.purchaseApproval||null}});
      await repo.notificationFanout(db,{shopId:user.shopId,tenderId:id,title:`${label}：${tender.data.partName}`,recipientRole:body.action==='submit-approval'?'manager':'warehouse',summary:approval.reason||'请打开询价详情查看采购审批单'});
      return repo.detail(user.shopId,id,db);
    }

    if(body.action==='close') {
      if(tender.status==='closed')return repo.detail(user.shopId,id,db);
      if(tender.status!=='open')throw new HttpError(409,'询价已结束');
      await repo.closeTender(db,id);
    } else if(body.action==='update') {
      if(!['open','closed'].includes(tender.status))throw new HttpError(409,'已结标或取消的询价不能编辑');
      if(body.expectedVersion!==tender.version)throw new HttpError(409,'询价已变化，请刷新后重新编辑');
      const input=tenderInput({...body,requestId:randomUUID(),supplierIds:tender.invitations.map(i=>i.supplierId)});
      await assertProcurementPhotos(db,user.shopId,[...input.data.nameplatePhotoIds,...input.data.otherPhotoIds]);
      const {deliveryAddress:ignored,...previousTerms}=tender.data;
      const termsChanged=!same(input.data,previousTerms),deadlineChanged=input.deadline!==tender.deadline;
      if(!termsChanged&&!deadlineChanged)return repo.detail(user.shopId,id,db);
      if(tender.status==='closed'&&body.reopen!==true)throw new HttpError(409,'报价已结束，请确认重新开放后保存修改');
      await repo.amendTender(db,id,{data:input.data,deadline:input.deadline,termsChanged,reopen:tender.status==='closed'});
      await repo.audit(db,{shopId:user.shopId,tenderId:id,actor:user.name,action:'修改询价',detail:{before:{data:tender.data,deadline:tender.deadline,termsVersion:tender.termsVersion},after:{data:input.data,deadline:input.deadline,termsVersion:tender.termsVersion+(termsChanged?1:0)},reopened:tender.status==='closed'}});
      await repo.notificationFanout(db,{shopId:user.shopId,tenderId:id,title:`询价信息已更新：${input.data.partName}`,summary:termsChanged?'采购要求已修改，原报价需按新要求重新确认。':'报价截止时间已调整，已有报价继续有效。'});
      return repo.detail(user.shopId,id,db);
    } else if(body.action==='invalidate') {
      if(!['open','closed'].includes(tender.status))throw new HttpError(409,'询价已结标');
      const inv=tender.invitations.find(i=>i.id===body.invitationId);if(!inv)throw missing();
      await repo.invalidate(db,inv.id,text(body.reason??'','报价失效原因',1000,false),user);
    } else if(['settle','cancel'].includes(body.action)) {
      const result=settlement(tender,body);await repo.settleTender(db,id,result);
     } else if(['share-link','revoke-shared-link'].includes(body.action)) {
      if(tender.status==='cancelled')throw new HttpError(409,'已取消询价不能分享');
      await repo.revokeSharedLinks(db,id);
      const link=body.action==='share-link'?await newLink(db,{tenderId:id,supplierName:'本次询价全部受邀供应商',readOnly:['awarded','failed'].includes(tender.status)}):null;
      await repo.audit(db,{shopId:user.shopId,tenderId:id,actor:user.name,action:link?'生成统一询价链接':'停用统一询价链接'});
      return {...await repo.detail(user.shopId,id,db),link};
    } else if(['reissue-link','revoke-link'].includes(body.action)) {
      const inv=tender.invitations.find(i=>i.id===body.invitationId);if(!inv)throw missing();
      await repo.revokeLinks(db,{invitationId:inv.id});
      let link=null;
      if(body.action==='reissue-link') {if(['cancelled'].includes(tender.status))throw new HttpError(409,'已取消询价不能生成链接');link=await newLink(db,{invitationId:inv.id,supplierName:inv.supplierName,readOnly:['awarded','failed'].includes(tender.status)});}
      await repo.audit(db,{shopId:user.shopId,tenderId:id,actor:user.name,action:body.action==='reissue-link'?'重发邀请链接':'撤销邀请链接',detail:{supplierId:inv.supplierId}});
      if(link)await repo.notificationFanout(db,{shopId:user.shopId,tenderId:id,title:`供应商邀请链接已重发：${tender.data.partName}`});
      return {...await repo.detail(user.shopId,id,db),link};
    } else throw new HttpError(400,'未知操作');
    await repo.audit(db,{shopId:user.shopId,tenderId:id,actor:user.name,action:({close:'结束报价收集',invalidate:'处理报价有效性',settle:'确认结标',cancel:'取消询价'})[body.action],detail:{reason:body.reason||'',winnerId:body.winnerId||null,winnerIds:body.winnerIds||[],invitationId:body.invitationId||null}});
    return repo.detail(user.shopId,id,db);});
}
export async function analytics(user,from,to,category) {procurementAccess(user);const range=dateRange(from,to);const tenders=await repo.readTenders(user.shopId,range);return analyze(category?tenders.filter(t=>t.data.category===text(category,'配件类别',100)):tenders,range);}
export async function createReport(user,body) {
  procurementAccess(user);const supplierId=uuid(body.supplierId),range=dateRange(body.from,body.to),note=text(body.note??'','合作建议',1000,false);
  return transaction(async db=>{await actor(user,db);const supplier=await repo.supplierById(user.shopId,supplierId,db);if(!supplier)throw missing();
    // A repeatable snapshot is persisted before publication; no internal per-tender prices are copied.
    const tenders=await repo.readTenders(user.shopId,range,db),id=randomUUID();
    const snapshot=supplierReport(tenders,repo.mapSupplier(supplier),range,{id,note});
    await repo.insertReport(db,user,id,supplierId,snapshot);await repo.audit(db,{shopId:user.shopId,supplierId,actor:user.name,action:'生成报告预览',detail:{reportId:id}});
    return {id,snapshot,publishedAt:null,notifications:[]};});
}
export async function reports(user) {procurementAccess(user);return repo.reportList(pool,user.shopId);}
export async function reportDetail(user,id) {
  procurementAccess(user);const record=await repo.reportById(pool,user.shopId,uuid(id));if(!record)throw missing();
  return {id:record.id,snapshot:record.snapshot,publishedAt:record.published_at?iso(record.published_at):null,notifications:await repo.deliveries(pool,{reportId:id}),activity:await repo.reportActivity(pool,user.shopId,id)};
}
export async function reportAction(user,id,body) {
  procurementAccess(user);
  return transaction(async db=>{await actor(user,db);const record=await repo.reportById(db,user.shopId,uuid(id),true);if(!record)throw missing();
    await repo.revokeLinks(db,{reportId:id});
    let link=null;
    if(body.action==='publish') {link=await newLink(db,{reportId:id,supplierName:record.snapshot.supplierName});await repo.publishReport(db,id);await repo.notificationFanout(db,{shopId:user.shopId,reportId:id,title:`供应商表现报告已发布：${record.snapshot.supplierName}`});}
    else if(body.action!=='revoke')throw new HttpError(400,'未知报告操作');
    await repo.audit(db,{shopId:user.shopId,supplierId:record.supplier_id,actor:user.name,action:body.action==='publish'?'发布报告':'撤销报告链接',detail:{reportId:id}});
    return {link};});
}
export async function verifyPortal(body,ip) {
  const token=text(body.token,'链接凭证',100),phone=text(body.phone,'手机号',20).replace(/[\s-]/g,''),identity=text(body.identity,'姓名或供应商名称',100);
  const ipKey=hashToken(`procurement-verify:${ip}`),linkKey=hashToken(`procurement-link:${token}:${phone}:${identity}`);
  if(await repo.accessAttempt(ipKey)>60||await repo.accessAttempt(linkKey)>20)throw new HttpError(429,'尝试次数过多，请15分钟后再试');
  const initial=await repo.findLink(pool,hashToken(token));
  if(!initial)throw new HttpError(403,'链接无效、已撤销或已过期');
  return transaction(async db=>{
    // Invitation verification and reissue both lock parent before link, including audit FK checks.
    if(initial.tender_id)await repo.lockTender(initial.tender_id,db);
    const link=await repo.findLink(db,hashToken(token));if(!link)throw new HttpError(403,'链接无效、已撤销或已过期');
    if(link.tender_id&&!link.invitation_id&&!link.report_id) {
      const invitation=await repo.sharedInvitation(db,link.tender_id,phone,identity);
      if(!invitation)throw new HttpError(403,'信息不匹配或未受邀，请联系采购员核实');
      link.invitation_id=invitation.id;link.supplier_id=invitation.supplier_id;
    }
    const supplier=await repo.supplierById(link.shop_id,link.supplier_id,db);
    if(!supplier?.active||supplier.phone!==phone||![supplier.name,supplier.contact_name].includes(identity))throw new HttpError(403,'信息不匹配，请联系采购员核实');
    const session=randomBytes(32).toString('base64url'),expiresAt=new Date(Math.min(Date.now()+7*86400000,Date.parse(link.expires_at)));
    await repo.saveSession(db,hashToken(session),link.id,expiresAt,link.invitation_id);
    await repo.audit(db,{shopId:link.shop_id,tenderId:link.tender_id,supplierId:link.supplier_id,actor:supplier.contact_name,action:'信息匹配后访问',detail:link.report_id?{reportId:link.report_id}:{}});
    return {session,maxAge:Math.floor((expiresAt-Date.now())/1000)};});
}
async function portalContext(db,session) {
  if(typeof session!=='string'||session.length>100)throw new HttpError(401,'请先填写供应商信息');
  const link=await repo.sessionLink(db,hashToken(session));if(!link)throw new HttpError(401,'访问已失效，请重新打开邀请链接');
  const supplier=await repo.supplierById(link.shop_id,link.supplier_id,db);if(!supplier?.active)throw new HttpError(403,'供应商已停用，请联系采购员');
  return {link,supplier};
}
export async function portal(session) {
  return transaction(async db=>{const {link,supplier}=await portalContext(db,session);
    if(link.report_id) {const record=await repo.reportById(db,link.shop_id,link.report_id);return {kind:'report',report:record.snapshot};}
    const tender=(await repo.readTenders(link.shop_id,{id:link.tender_id},db))[0],own=tender.invitations.find(i=>i.id===link.invitation_id);
    const result=tender.status==='awarded'?(procurementWinnerIds(tender).includes(link.supplier_id)?(procurementWinnerIds(tender).length>1?'您已中标，实际采购数量请与采购员线下确认':'您已中标，请联系采购员确认供货'):'本次未中标'):tender.status==='failed'?'本次询价已流标':tender.status==='cancelled'?'本次询价已取消':'尚未确认中标结果';
    return {kind:'quote',supplierName:supplier.name,tenderId:tender.id,invitationId:own.id,termsVersion:tender.termsVersion,terms:tender.data,status:tender.status,deadline:tender.deadline,quotes:own.quotes,result};});
}
export async function quote(session,body) {
  // Resolve the parent without locking links, then always lock parent -> link; revocation uses the same order.
  const initial=await repo.sessionLink(pool,hashToken(session||''));if(!initial?.invitation_id)throw new HttpError(401,'报价访问已失效');
  return transaction(async db=>{const raw=await repo.lockTender(initial.tender_id,db);const {link,supplier}=await portalContext(db,session);
    if(link.invitation_id!==initial.invitation_id||body.invitationId!==link.invitation_id)throw new HttpError(409,'报价页面已切换，请刷新后重试');
    const input=quoteInput(body,raw.data);
    const prior=await repo.quoteRequest(db,link.invitation_id,input.requestId);
    if(prior){if(!same(prior.data,input))throw new HttpError(409,'请求编号已被不同报价使用');return {ok:true};}
    if(input.termsVersion!==raw.terms_version)throw new HttpError(409,'采购要求已修改，请刷新页面后按新要求重新报价');
    const now=await repo.databaseClock(db);
    if(effectiveStatus(raw,Date.parse(now))!=='open')throw new HttpError(409,'报价已结束，不能提交或修改');
    const submitted=await repo.submitQuote(db,link.invitation_id,input);
    if(!submitted.saved)throw new HttpError(409,'报价已结束，不能提交或修改');
    await repo.audit(db,{shopId:link.shop_id,tenderId:link.tender_id,supplierId:link.supplier_id,actor:supplier.contact_name,action:input.declined?'放弃报价':'提交报价',detail:{requestId:input.requestId}});
    await repo.notificationFanout(db,{shopId:link.shop_id,tenderId:link.tender_id,
      title:`${supplier.name}${input.declined?'已放弃报价':'已提交报价'}：${raw.data.partName}`,
      summary:input.declined?'供应商已明确放弃本次报价。':`含税含运费总价：¥${(input.totalFen/100).toFixed(2)}；请进入后台查看交期及报价记录。`});
    await repo.notifyQuoteCompletion(db,link.shop_id,link.tender_id);
    return {ok:true};});
}
export async function feedback(session,body) {
  const value=text(body.feedback,'反馈内容',1000);
  return transaction(async db=>{const {link,supplier}=await portalContext(db,session);if(!link.report_id||body.reportId!==link.report_id)throw new HttpError(400,'请从报告页面反馈');
    await repo.reportFeedback(db,link,value,supplier.contact_name);return {ok:true};});
}

export async function resumePortal(session,body) {
  const token=text(body.token,'链接凭证',100);
  const current=await repo.sessionLink(pool,hashToken(session||''));
  if(!current||current.token_hash!==hashToken(token))throw new HttpError(401,'请填写供应商信息');
  return portal(session);
}

export async function authorizePortalPhoto(session,id) {
 const view=await portal(session);
 if(view.kind!=='quote'||![...(view.terms.nameplatePhotoIds||[]),...(view.terms.otherPhotoIds||[])].includes(id))throw new HttpError(403,'无权查看此询价照片');
}
