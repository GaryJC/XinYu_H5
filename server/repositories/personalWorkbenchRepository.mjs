import {pendingHistory,addEscalatedTodos} from './pendingReminderRepository.mjs';
import {pool} from '../database/pool.mjs';
import {hasRole,hasAnyRole} from '../../shared/roles.mjs';
import {mapTask} from './dispatchRepository.mjs';
import {personalOrderTodos} from '../domain/personalWorkbench.mjs';
const inboxProjection=`notice_kind as "noticeKind",id::text,title,summary,plate,target_key as "targetKey",target_id as "targetId",created_at as "createdAt",read_at as "readAt"`;
export async function readInbox(user,{before,unread=false,resultsOnly=false}={},db=pool) {
 const {rows}=await db.query(`select ${inboxProjection} from personal_inbox where recipient_id=$1 and shop_id=$2
  and (not $5::boolean or notice_kind='result') and ($3::bigint is null or id<$3) and (not $4::boolean or read_at is null) order by id desc limit 41`,[user.id,user.shopId,before||null,unread,resultsOnly]);
 return {items:rows.slice(0,40),nextCursor:rows.length>40?rows[39].id:null};
}
export async function markInboxRead(user,{id,through},db=pool) {
 await db.query(`update personal_inbox set read_at=now() where recipient_id=$1 and shop_id=$2 and read_at is null
  and (case when $3::bigint is not null then id=$3 else id<=$4::bigint end)`,[user.id,user.shopId,id||null,through||null]);
}
export async function readPersonalWorkbench(user,db=pool,{includeTodos=true}={}) {
 const {rows:[summary]}=await db.query(`select (select count(*)::integer from personal_inbox where recipient_id=$1 and shop_id=$2 and read_at is null and notice_kind='result') as unread,
  coalesce((select id from personal_inbox where recipient_id=$1 and shop_id=$2 order by id desc limit 1),0)::text as "latestId"`,[user.id,user.shopId]);
 const todos=[];
 if(hasAnyRole(user,['manager','advisor','technician','outsourcing','inspector','warehouse'])) {
  const {rows}=await db.query(`select w.id as order_id,w.shop_id,w.advisor,w.status as order_status,w.vehicle_plate,w.dispatch_no,
    w.customer_signature_review,w.pending_repairs,w.paper_order,w.legacy_sync_status,d.stage,d.technician_id,d.inspector_id,d.data,
    '[]'::jsonb as repair_items from work_orders w left join dispatch_tasks d on d.order_id=w.id
    where w.shop_id=$1 and w.status<>'待处理纸质委托书'
    and ($4::boolean or w.advisor=$3 or d.technician_id=$2 or coalesce(d.data->'technicianIds','[]'::jsonb)?$2
      or coalesce(d.data->'participantIds','[]'::jsonb)?$2)
    and (w.status not in ('完成','待结算') or w.customer_signature_review->>'state'='pending'
      or exists(select 1 from jsonb_array_elements(w.pending_repairs) p where p->>'sourceInspectorId'=$2 and p->>'inspectionState'='pending'))`,[user.shopId,user.id,user.name,hasAnyRole(user,['manager','advisor','inspector','warehouse'])]);
  for(const row of rows){
   todos.push(...personalOrderTodos(mapTask(row),user,row.customer_signature_review,row.pending_repairs));
   if(row.paper_order?.mode==='dingtalk'&&!['草稿','待处理纸质委托书'].includes(row.order_status)&&['pending','processing','failed'].includes(row.legacy_sync_status)&&row.advisor===user.name&&hasAnyRole(user,['advisor','manager']))todos.push({id:`order:${row.order_id}:委托书待同步`,category:'委托书待同步',title:row.vehicle_plate||'纸质委托书',summary:row.legacy_sync_status==='failed'?'润丰同步失败，请查看原因':'等待润丰同步',targetKey:'workOrder',targetId:row.order_id});
  }
 }
 const {rows:trips}=await db.query(`select id,status,vehicle_snapshot,reason,applicant_id from vehicle_trip_requests where shop_id=$1
  and ((applicant_id=$2 and status in ('待审批','待出车')) or ($3 and applicant_id<>$2 and status='待审批')) order by created_at`,[user.shopId,user.id,hasRole(user,'manager')]);
 for(const trip of trips)todos.push({id:`trip:${trip.id}`,category:trip.status==='待审批'?(trip.applicant_id===user.id?'申请待审批':'用车待审批'):'待出车',title:trip.vehicle_snapshot?.plate||'用车申请',summary:trip.reason,targetKey:'vehicleTrip',targetId:trip.id});
 if(hasAnyRole(user,['warehouse','manager'])) {
  const {rows}=await db.query(`select id,status,data,purchase_approval from procurement_tenders where shop_id=$1
   and (($2 and (status in ('open','closed') or status='awarded' and (purchase_approval is null or purchase_approval->>'status'='rejected'))) or ($3 and purchase_approval->>'status'='pending' and purchase_approval->>'submittedBy'<>$4)) order by created_at`,[user.shopId,hasRole(user,'warehouse'),hasRole(user,'manager'),user.id]);
  for(const tender of rows)todos.push({id:`tender:${tender.id}`,category:tender.purchase_approval?.status==='pending'&&hasRole(user,'manager')&&tender.purchase_approval.submittedBy!==user.id?'采购待审批':tender.status==='awarded'?'采购待提报':tender.status==='open'?'询价跟进':'报价待处理',title:tender.data.partName||'配件采购',summary:tender.data.specification||'',targetKey:'procurementTender',targetId:tender.id});
 }
 await addEscalatedTodos(db,user,todos);
 const following=todos.filter(t=>t.category==='申请待审批');
 const actionable=todos.filter(t=>t.category!=='申请待审批');
 if(includeTodos)await pendingHistory(db,user,actionable);
 return {...summary,todoCount:actionable.length,followingCount:following.length,todos:includeTodos?actionable:[],following:includeTodos?following:[],updatedAt:new Date().toISOString()};
}
