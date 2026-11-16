import {randomUUID} from 'node:crypto';
import {finishNotificationTrace} from './notificationUsageRepository.mjs';
import {pool,transaction} from '../database/pool.mjs';
import {mapTask} from './dispatchRepository.mjs';
import {pendingSnapshotSlots,businessMinutesBetween,addBusinessMinutes,reminderMinutes,nextBusinessTime,nextBusinessMorning,reminderRecipient} from '../domain/pendingReminders.mjs';
export function hydratePendingSnapshot(value){
 if(!value?.order)return value||{};
 const w=value.order,d=value.dispatch||{};
 return {...value,task:mapTask({order_id:w.id,shop_id:w.shop_id,advisor:w.advisor,order_status:w.status,vehicle_plate:w.vehicle_plate,dispatch_no:w.dispatch_no,...d,repair_items:[]})};
}
export async function currentPendingSnapshot(db,source,id){
 if(source==='trip')return {trip:(await db.query('select id,shop_id,status,applicant_id,vehicle_snapshot from vehicle_trip_requests where id=$1',[id])).rows[0]};
 return hydratePendingSnapshot((await db.query('select pending_order_snapshot($1) as value',[id])).rows[0]?.value);
}
export async function projectPendingEvents(runTransaction=transaction){
 return runTransaction(async db=>{
  if(!(await db.query("select pg_try_advisory_xact_lock(hashtextextended('personal-pending-projector',0)) as locked")).rows[0].locked)return 0;
  const events=(await db.query('select * from personal_pending_events order by id limit 100 for update')).rows;
  for(const event of events){
   const snapshot=hydratePendingSnapshot(event.snapshot),slots=pendingSnapshotSlots(snapshot),shop=snapshot.order?.shop_id||snapshot.trip?.shop_id;
   await db.query('update personal_pending_subjects set closed_at=$3,next_reminder_at=null where source_key=$1 and target_id=$2 and closed_at is null and not(slot_key=any($4::text[]))',[event.source_key,event.target_id,event.created_at,slots.map(s=>s.key)]);
   for(const slot of slots){
    const due=slot.failed?nextBusinessTime(event.created_at):addBusinessMinutes(event.created_at,reminderMinutes[slot.kind]);
    await db.query(`insert into personal_pending_subjects(source_key,target_id,shop_id,slot_key,kind,slot,snapshot,entered_at,eligible,next_reminder_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict(source_key,target_id,slot_key) where closed_at is null do update set slot=excluded.slot,snapshot=excluded.snapshot,
     next_reminder_at=case when personal_pending_subjects.eligible and personal_pending_subjects.level=0 and excluded.slot->>'failed'='true' then least(personal_pending_subjects.next_reminder_at,excluded.next_reminder_at) else personal_pending_subjects.next_reminder_at end`,
     [event.source_key,event.target_id,shop,slot.key,slot.kind,slot,snapshot,event.created_at,!event.baseline,event.baseline?null:due]);
   }
   await db.query('delete from personal_pending_events where id=$1',[event.id]);
  }
  return events.length;
 });
}
export async function pendingUsers(db,shop){return (await db.query('select *,shop_id as "shopId",inspector_role_member as "inspectorRoleMember" from users where active and shop_id=$1',[shop])).rows;}
export async function queuePendingReminders(now=new Date(),runTransaction=transaction){
 return runTransaction(async db=>{
  const rows=(await db.query('select * from personal_pending_subjects where closed_at is null and eligible and next_reminder_at<=$1 order by next_reminder_at,id limit 100 for update skip locked',[now])).rows;
  const users=new Map();
  for(const row of rows){
   const snapshot=await currentPendingSnapshot(db,row.source_key,row.target_id),slot=pendingSnapshotSlots(snapshot).find(s=>s.key===row.slot_key);
   if(!slot){await db.query('update personal_pending_subjects set closed_at=$2,next_reminder_at=null where id=$1',[row.id,now]);continue;}
   if(!users.has(row.shop_id))users.set(row.shop_id,await pendingUsers(db,row.shop_id));
   const stage=row.level<2?String(row.level):new Date(now.getTime()+8*3600000).toISOString().slice(0,10);
   // Daily digests return to the actual handler; escalation adds administrators once.
   const audience=users.get(row.shop_id).filter(u=>reminderRecipient(slot,snapshot,u,row.level===1?1:0));
   for(const user of audience)await db.query('insert into personal_pending_deliveries(subject_id,recipient_id,stage,level) values($1,$2,$3,$4) on conflict do nothing',[row.id,user.id,stage,row.level]);
   const next=row.level===0?addBusinessMinutes(now,120):nextBusinessMorning(now);
   // No eligible handler yet: recheck instead of consuming the first escalation stage.
   await db.query('update personal_pending_subjects set level=$2,next_reminder_at=$3 where id=$1',[row.id,audience.length?Math.min(2,row.level+1):row.level,audience.length?next:addBusinessMinutes(now,5)]);
  }
  return rows.length;
 });
}
export async function claimPendingDigest(runTransaction=transaction){
 return runTransaction(async db=>{
  if(!(await db.query("select pg_try_advisory_xact_lock(hashtextextended('personal-pending-send',0)) as locked")).rows[0].locked)return [];
  const first=(await db.query("select d.recipient_id from personal_pending_deliveries d where d.status='pending' and (d.lease_until is null or d.lease_until<=now()) and not exists(select 1 from personal_pending_deliveries busy where busy.recipient_id=d.recipient_id and busy.status='pending' and busy.lease_until>now()) order by d.id limit 1")).rows[0];if(!first)return [];
  return (await db.query(`with candidates as(select id from personal_pending_deliveries where recipient_id=$1 and status='pending' and (lease_until is null or lease_until<=now()) order by id for update skip locked)
   update personal_pending_deliveries d set lease_id=$2,lease_until=now()+interval '90 seconds' from candidates c where d.id=c.id returning d.*`,[first.recipient_id,randomUUID()])).rows;
 });
}
export async function sealPendingDigest(db,rows){
 if(!rows.length)return false;
 const result=await db.query(`update personal_pending_deliveries set status='unknown',submitted_at=now()
 where id=any($1::bigint[]) and lease_id=$2 and status='pending' and lease_until>now()
 and (select count(*) from personal_pending_deliveries where id=any($1::bigint[]) and lease_id=$2 and status='pending' and lease_until>now())=$3 returning id`,[rows.map(r=>r.id),rows[0].lease_id,rows.length]);
 return result.rowCount===rows.length;
}
export async function finishPendingDelivery(db,row,result){await db.query("update personal_pending_deliveries set status=$2,finished_at=now(),task_id=$3,error=$4,lease_until=null where id=$1 and lease_id=$5 and (status='unknown' or (status='pending' and lease_until>now()))",[row.id,result.status,result.taskId||null,result.error||'',row.lease_id]);}
export async function pendingDeliveryContext(db,row){const subject=(await db.query('select * from personal_pending_subjects where id=$1',[row.subject_id])).rows[0];if(!subject||subject.closed_at)return {};
 const snapshot=await currentPendingSnapshot(db,subject.source_key,subject.target_id),slot=pendingSnapshotSlots(snapshot).find(s=>s.key===subject.slot_key);
 const user=(await pendingUsers(db,subject.shop_id)).find(u=>u.id===row.recipient_id);
 return slot&&reminderRecipient(slot,snapshot,user,row.level===1?1:0)?{subject,snapshot,slot,user}:{};
}
export async function addEscalatedTodos(db,user,todos){
 if(!user.active)return;
 const rows=(await db.query(`select distinct s.* from personal_pending_subjects s join personal_pending_deliveries d on d.subject_id=s.id
 where s.shop_id=$1 and s.closed_at is null and d.recipient_id=$2 and d.level=1 and d.status<>'cancelled'`,[user.shopId,user.id])).rows;
 for(const row of rows){
  if(todos.some(t=>t.targetId===row.target_id&&t.category===row.kind))continue;
  const snapshot=await currentPendingSnapshot(db,row.source_key,row.target_id),slot=pendingSnapshotSlots(snapshot).find(s=>s.key===row.slot_key);
  if(slot&&reminderRecipient(slot,snapshot,user,1))todos.push({id:`escalated:${row.target_id}:${slot.kind}`,category:slot.kind,title:slot.title,summary:'超时未处理，已升级提醒',targetKey:slot.targetKey,targetId:row.target_id});
 }
}
export async function pendingHistory(db,user,todos){
 if(!todos.length)return;
 const ids=[...new Set(todos.map(t=>t.targetId))];
 const events=(await db.query(`select title,created_at,target_id from personal_inbox where recipient_id=$1 and shop_id=$2 and target_id=any($3::text[]) and notice_kind='action' order by id desc limit 100`,[user.id,user.shopId,ids])).rows;
 for(const todo of todos)todo.eventHistory=events.filter(e=>e.target_id===todo.targetId).slice(0,10).map(e=>({at:e.created_at.toISOString(),label:e.title}));
 const subjects=(await db.query('select * from personal_pending_subjects where target_id=any($1::text[]) and shop_id=$2 and closed_at is null',[ids,user.shopId])).rows;
 const history=(await db.query(`select d.subject_id,d.level,d.status,d.created_at from personal_pending_deliveries d join personal_pending_subjects s on s.id=d.subject_id
 where s.target_id=any($1::text[]) and s.shop_id=$2 and d.recipient_id=$3 order by d.id desc limit 100`,[ids,user.shopId,user.id])).rows;
 for(const todo of todos){const matching=subjects.filter(s=>s.target_id===todo.targetId&&s.kind===todo.category);if(!matching.length)continue;
 todo.waitingSince=matching.filter(s=>s.eligible).map(s=>s.entered_at.toISOString()).sort()[0];
 todo.waitingMinutes=todo.waitingSince?Math.floor(businessMinutesBetween(todo.waitingSince)):undefined;
 todo.reminderHistory=history.filter(h=>matching.some(s=>s.id===h.subject_id)).slice(0,10).map(h=>({at:h.created_at.toISOString(),label:h.level===0?'首次超时提醒':h.level===1?'升级提醒':'每日汇总',status:h.status}));
 }
}

export function pendingTraceRecorder(database,first){return {
 start:async c=>{
  await database.query({text:'insert into notification_tracking_epoch(id) values(true) on conflict do nothing',query_timeout:500});
  await database.query({text:`insert into notification_call_traces(id,operation,source,notification_id,shop_id,resource_id,event_key,recipient_id,recipient_name,kind)
   values($1,$2,'pending-reminder',$3,$4,$5,$3,$6,$7,'待办超时提醒')`,values:[c.id,c.operation,String(first.row.id),first.subject.shop_id,first.subject.target_id,first.user.id,first.user.name],query_timeout:500});
 },finish:(id,result)=>finishNotificationTrace(database,id,result)
};}
