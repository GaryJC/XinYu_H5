import { randomUUID } from 'node:crypto';
import { pool } from '../database/pool.mjs';
import { effectiveStatus } from '../domain/procurement.mjs';
export function mapSupplier(row) {return {id:row.id,name:row.name,contactName:row.contact_name,phone:row.phone,categories:row.categories,note:row.note,active:row.active};}
export async function suppliers(shopId,db=pool) {return (await db.query('select * from procurement_suppliers where shop_id=$1 order by name,id',[shopId])).rows.map(mapSupplier);}
export async function saveSupplier(shopId,id,data,db) {
  return mapSupplier((await db.query(`insert into procurement_suppliers(id,shop_id,name,contact_name,phone,categories,note,active) values($1,$2,$3,$4,$5,$6,$7,$8)
    on conflict(id) do update set name=excluded.name,contact_name=excluded.contact_name,phone=excluded.phone,categories=excluded.categories,note=excluded.note,active=excluded.active,updated_at=now()
    where procurement_suppliers.shop_id=excluded.shop_id returning *`,[id,shopId,data.name,data.contactName,data.phone,data.categories,data.note,data.active])).rows[0]);
}
export async function supplierById(shopId,id,db) {return (await db.query('select * from procurement_suppliers where id=$1 and shop_id=$2',[id,shopId])).rows[0];}
export async function currentActor(user,db) {return (await db.query('select id,active,role,shop_id as "shopId",name from users where id=$1 for share',[user.id])).rows[0];}
export async function audit(db,{shopId,tenderId=null,supplierId=null,actor,action,detail={}}) {
  await db.query('insert into procurement_audit(shop_id,tender_id,supplier_id,actor,action,detail) values($1,$2,$3,$4,$5,$6)',[shopId,tenderId,supplierId,actor,action,JSON.stringify(detail)]);
}
export async function lockTender(id,db) {return (await db.query('select * from procurement_tenders where id=$1 for update',[id])).rows[0];}
export async function freezeDue(db,id=null) {
  await db.query(`update procurement_tenders set status='closed',closed_at=deadline,version=version+1 where status='open' and deadline<=clock_timestamp() ${id?'and id=$1':''}`,id?[id]:[]);
}
export async function createTender(db,user,id,input) {
  const {rows:[row]}=await db.query(`insert into procurement_tenders(id,shop_id,created_by,request_id,request_body,data,deadline) values($1,$2,$3,$4,$5,$6,$7)
    on conflict(created_by,request_id) do nothing returning *`,[id,user.shopId,user.id,input.requestId,JSON.stringify(input),JSON.stringify(input.data),input.deadline]);
  return row;
}
export async function tenderRequest(db,user,requestId) {return (await db.query('select * from procurement_tenders where created_by=$1 and request_id=$2',[user.id,requestId])).rows[0];}
export async function invitation(db,id) {return (await db.query('select * from procurement_invitations where id=$1',[id])).rows[0];}
export async function addInvitation(db,tenderId,supplier) {
  const id=randomUUID();
  return (await db.query('insert into procurement_invitations(id,tender_id,supplier_id,supplier_snapshot) values($1,$2,$3,$4) returning *',[id,tenderId,supplier.id,JSON.stringify(mapSupplier(supplier))])).rows[0];
}
export async function saveLink(db,{id,invitationId=null,reportId=null,hash,expiresAt}) {
  await db.query('insert into procurement_links(id,invitation_id,report_id,token_hash,expires_at) values($1,$2,$3,$4,$5)',[id,invitationId,reportId,hash,expiresAt]);
}
export async function revokeLinks(db,{invitationId=null,reportId=null}) {
  await db.query(`update procurement_links set revoked_at=clock_timestamp() where revoked_at is null and ${invitationId?'invitation_id':'report_id'}=$1`,[invitationId||reportId]);
}
export async function findLink(db,hash) {
  return (await db.query(`select l.*,coalesce(i.supplier_id,r.supplier_id) as supplier_id,coalesce(t.shop_id,r.shop_id) as shop_id,t.id as tender_id
    from procurement_links l left join procurement_invitations i on i.id=l.invitation_id left join procurement_tenders t on t.id=i.tender_id
    left join procurement_reports r on r.id=l.report_id where l.token_hash=$1 and l.revoked_at is null and l.expires_at>clock_timestamp() for share of l`,[hash])).rows[0];
}
export async function sessionLink(db,hash) {
  return (await db.query(`select l.*,s.created_at as session_created_at,coalesce(i.supplier_id,r.supplier_id) as supplier_id,coalesce(t.shop_id,r.shop_id) as shop_id,t.id as tender_id
    from procurement_sessions s join procurement_links l on l.id=s.link_id left join procurement_invitations i on i.id=l.invitation_id
    left join procurement_tenders t on t.id=i.tender_id left join procurement_reports r on r.id=l.report_id
    where s.token_hash=$1 and s.expires_at>clock_timestamp() and l.revoked_at is null and l.expires_at>clock_timestamp() for share of l`,[hash])).rows[0];
}
export async function saveSession(db,hash,linkId,expiresAt) {await db.query('insert into procurement_sessions(token_hash,link_id,expires_at) values($1,$2,$3)',[hash,linkId,expiresAt]);}
export async function accessAttempt(key,db=pool) {
  const {rows:[row]}=await db.query(`insert into procurement_access_attempts(key,expires_at) values($1,now()+interval '15 minutes')
    on conflict(key) do update set count=case when procurement_access_attempts.expires_at<=now() then 1 else procurement_access_attempts.count+1 end,
    expires_at=case when procurement_access_attempts.expires_at<=now() then now()+interval '15 minutes' else procurement_access_attempts.expires_at end returning count`,[key]);
  return row.count;
}
const iso=value=>value?new Date(value).toISOString():null;
export async function readTenders(shopId,{id,from,to}={},db=pool) {
  const {rows}=await db.query(`select * from procurement_tenders where shop_id=$1 ${id?'and id=$2':from?'and coalesce(closed_at,deadline)>=$2 and coalesce(closed_at,deadline)<$3 and (status<>\'open\' or deadline<=now())':''} order by created_at desc,id desc`,id?[shopId,id]:from?[shopId,from,to]:[shopId]);
  if(!rows.length)return [];
  const ids=rows.map(r=>r.id);
  const {rows:invitations}=await db.query(`select i.*,v.reason as invalid_reason from procurement_invitations i left join procurement_invalidations v on v.invitation_id=i.id where i.tender_id=any($1::uuid[]) order by i.id`,[ids]);
  const {rows:quotes}=await db.query(`select q.* from procurement_quotes q join procurement_invitations i on i.id=q.invitation_id where i.tender_id=any($1::uuid[]) order by q.submitted_at desc,q.id desc`,[ids]);
  return rows.map(r=>({id:r.id,version:r.version,termsVersion:r.terms_version,data:r.data,status:effectiveStatus(r),deadline:iso(r.deadline),closedAt:iso(r.closed_at||(r.status==='open'&&r.deadline&&Date.parse(r.deadline)<=Date.now()?r.deadline:null)),
    createdAt:iso(r.created_at),winnerId:r.winner_id,reason:r.reason,invitations:invitations.filter(i=>i.tender_id===r.id).map(i=>({id:i.id,supplierId:i.supplier_id,supplierName:i.supplier_snapshot.name,invalidReason:i.invalid_reason||'',
      quotes:quotes.filter(q=>q.invitation_id===i.id).map(q=>({...q.data,id:q.id,termsVersion:q.terms_version,submittedAt:iso(q.submitted_at)}))}))}));
}
export async function detail(shopId,id,db=pool) {
  const tender=(await readTenders(shopId,{id},db))[0];if(!tender)return null;
  const {rows:events}=await db.query('select id::text,actor,action,detail,at from procurement_audit where shop_id=$1 and tender_id=$2 order by procurement_audit.id desc',[shopId,id]);
  return {tender,audit:events.map(e=>({...e,at:iso(e.at)})),notifications:await deliveries(db,{tenderId:id})};
}
export async function deliveries(db,{tenderId=null,reportId=null}) {
  const column=tenderId?'tender_id':'report_id',id=tenderId||reportId;
  return (await db.query(`select n.id,n.status,n.error,u.name as "recipientName",n.created_at from procurement_notifications n join users u on u.id=n.recipient_id where n.${column}=$1
    union all select j.id,j.status,j.error,'通知接收人同步' as "recipientName",j.created_at from procurement_notification_jobs j where j.${column}=$1 and j.status<>'ready' order by created_at desc`,[id])).rows;
}
export async function notificationFanout(db,{shopId,tenderId=null,reportId=null,title,summary=''}) {
  await db.query('insert into procurement_notification_jobs(id,shop_id,tender_id,report_id,payload) values($1,$2,$3,$4,$5)',
    [randomUUID(),shopId,tenderId,reportId,JSON.stringify({title,summary,tenderId,reportId})]);
}
export async function databaseClock(db) {return (await db.query('select clock_timestamp() as now')).rows[0].now;}
export async function closeTender(db,id) {await db.query("update procurement_tenders set status='closed',closed_at=clock_timestamp(),version=version+1 where id=$1",[id]);}
export async function settleTender(db,id,result) {
  await db.query('update procurement_tenders set status=$2,version=version+1,winner_id=$3,reason=$4,closed_at=coalesce(closed_at,clock_timestamp()),settled_at=clock_timestamp() where id=$1',[id,result.status,result.winnerId,result.reason]);
  await db.query(`update procurement_links set expires_at=least(expires_at,now()+interval '30 days') where invitation_id in (select id from procurement_invitations where tender_id=$1)`,[id]);
}
export async function invalidate(db,invitationId,reason,user) {await db.query(`insert into procurement_invalidations(invitation_id,reason,actor_id) values($1,$2,$3)
 on conflict(invitation_id) do update set reason=excluded.reason,actor_id=excluded.actor_id,at=now()`,[invitationId,reason,user.id]);}
export async function submitQuote(db,invitationId,input) {
  const prior=(await db.query('select * from procurement_quotes where invitation_id=$1 and request_id=$2',[invitationId,input.requestId])).rows[0];
  if(prior)return {prior};
  const saved=(await db.query(`with stamp as materialized (select clock_timestamp() as at)
    insert into procurement_quotes(id,invitation_id,request_id,data,submitted_at,terms_version)
    select $1,i.id,$3,$4,stamp.at,$5 from procurement_invitations i join procurement_tenders t on t.id=i.tender_id cross join stamp
    where i.id=$2 and t.status='open' and t.terms_version=$5 and (t.deadline is null or stamp.at<t.deadline) returning *`,[randomUUID(),invitationId,input.requestId,JSON.stringify(input),input.termsVersion??1])).rows[0];
  return {saved};
}
export async function quoteRequest(db,invitationId,requestId) {return (await db.query('select * from procurement_quotes where invitation_id=$1 and request_id=$2',[invitationId,requestId])).rows[0];}
export async function reportById(db,shopId,id,lock=false) {return (await db.query(`select * from procurement_reports where shop_id=$1 and id=$2${lock?' for update':''}`,[shopId,id])).rows[0];}
export async function reportList(db,shopId) {return (await db.query('select id,snapshot,published_at as "publishedAt" from procurement_reports where shop_id=$1 order by created_at desc',[shopId])).rows;}
export async function insertReport(db,user,id,supplierId,snapshot) {await db.query('insert into procurement_reports(id,shop_id,supplier_id,snapshot,created_by) values($1,$2,$3,$4,$5)',[id,user.shopId,supplierId,JSON.stringify(snapshot),user.id]);}
export async function publishReport(db,id) {await db.query('update procurement_reports set published_at=now() where id=$1',[id]);}
export async function reportFeedback(db,link,feedback,actor) {await audit(db,{shopId:link.shop_id,supplierId:link.supplier_id,actor,action:'报告反馈',detail:{reportId:link.report_id,feedback}});}
export async function reportActivity(db,shopId,reportId) {return (await db.query("select id::text,actor,action,detail,at from procurement_audit where shop_id=$1 and detail->>'reportId'=$2 order by procurement_audit.id desc",[shopId,reportId])).rows;}

export async function amendTender(db,id,{data,deadline,termsChanged,reopen}) {
  await db.query(`update procurement_tenders set data=$2,deadline=$3,version=version+1,
    terms_version=terms_version+case when $4 then 1 else 0 end,
    status=case when $5 then 'open' else status end,closed_at=case when $5 then null else closed_at end where id=$1`,
    [id,JSON.stringify(data),deadline,termsChanged,reopen]);
  if(termsChanged)await db.query('delete from procurement_invalidations where invitation_id in (select id from procurement_invitations where tender_id=$1)',[id]);
}
