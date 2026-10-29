import { hasAnyRole } from '../../shared/roles.mjs';
import { outsourcingMembership } from './outsourcingMembership.mjs';
import { randomUUID } from 'node:crypto';
import { pool } from '../database/pool.mjs';
// Claim and mark unknown BEFORE sending. A crashed send must never be blindly replayed.
export async function claimNotification(database=pool) {
  const {rows}=await database.query(`with candidate as (
    select id,status as previous_status from dispatch_notifications
    where status in ('pending','accepted','unknown') and next_attempt_at<=now()
      and (locked_until is null or locked_until<now())
      and (status='pending' or task_id is not null)
    order by next_attempt_at,id for update skip locked limit 1
  ) update dispatch_notifications n set locked_until=now()+interval '90 seconds',lease_id=$1,
    status=case when c.previous_status='pending' then 'unknown' else n.status end,
    error=case when c.previous_status='pending' then '发送处理中；如进程中断需核对平台记录' else n.error end,
    attempts=n.attempts+case when c.previous_status='pending' then 1 else 0 end,
    polls=n.polls+case when c.previous_status='pending' then 0 else 1 end,
    updated_at=now()
    from candidate c where n.id=c.id returning n.*,c.previous_status`,[randomUUID()]);
  return rows[0];
}
export function notificationNextState(row,result) {
  let status=result.status; let delay=null;
  if(status==='failed' && result.retryable && row.attempts<5) {status='pending';delay=Math.min(3600,30*2**row.attempts);}
  if(['accepted','unknown'].includes(status) && (result.taskId || row.task_id)) {
    if(row.polls<20) delay=Math.min(1800,15*2**Math.min(row.polls,7));
    else status='unknown';
  }
  return {status,delay};
}
export async function finishNotification(row,result,database=pool) {
  const {status,delay}=notificationNextState(row,result);
  await database.query(`update dispatch_notifications set status=$3,task_id=coalesce($4,task_id),error=$5,retryable=$6,
    next_attempt_at=case when $7::integer is null then null else now()+make_interval(secs=>$7::integer) end,
    locked_until=null,lease_id=null,updated_at=now() where id=$1 and lease_id=$2`,
    [row.id,row.lease_id,status,result.taskId||null,result.error||'',Boolean(result.retryable),delay]);
}
export async function notificationRecipient(id,database=pool) {
  const {rows}=await database.query(`select id,shop_id as "shopId",dingtalk_user_id,active,role,inspector_role_member, roles, ${outsourcingMembership} from users where id=$1`,[id]); return rows[0]?{...rows[0],inspectorRoleMember:rows[0].inspector_role_member,outsourcingRoleMember:rows[0].outsourcing_role_member}:undefined;
}

// New-project messages are actionable only while that recipient still owns the work.
export async function validateAddedRepairRecipient(row,user,database=pool) {
  if(!user?.active || user.id!==row.recipient_id || !Array.isArray(row.payload?.itemIds) || !row.payload.itemIds.length) return false;
  const {rows}=await database.query(`select w.shop_id,d.stage,d.data from work_orders w
    join dispatch_tasks d on d.order_id=w.id where w.id=$1`,[row.order_id]);
  const task=rows[0];
  if(!task || user.shopId!==task.shop_id || !['待接单','待开工','维修中','暂停','回审'].includes(task.stage)
    || (task.data.repairRound||0)!==row.payload.repairRound) return false;
  const data=task.data;
  const ids=data.technicianIds??(data.technicianId?[data.technicianId]:[]);
  const allowed=data.executionMode==='outsourced'
    ? user.id===data.assignedBy&&hasAnyRole(user,['manager','advisor','inspector'])
    : ids.includes(user.id)&&hasAnyRole(user,['technician']);
  return allowed && row.payload.itemIds.every(id=>data.items?.some(item=>item.id===id
    && !['待检验','已完工'].includes(item.status) && (!item.responsibleId || item.responsibleId===user.id)));
}

// Both fanout workers call this while holding the work-order row lock. One
// submission is one notification per recipient, even with overlapping roles.
export async function hasSubmissionNotification(client,orderId,eventId,recipientId) {
 const {rows}=await client.query(`select 1 from dispatch_notifications
  where order_id=$1 and event_id=$2 and recipient_id=$3
   and kind in ('维修已提检','回审已提交','待检验') and status<>'failed' limit 1`,[orderId,eventId,recipientId]);
 return rows.length>0;
}
