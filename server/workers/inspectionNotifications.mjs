import {hasSubmissionNotification} from '../repositories/dispatchNotificationRepository.mjs';
import {hasPendingInspection} from '../../shared/repairProgress.mjs';
import { randomUUID } from 'node:crypto';
import { pool,transaction } from '../database/pool.mjs';
import { mapTask, localDispatchPeople, inspectionNotificationSnapshot } from '../repositories/dispatchRepository.mjs';
import {canReceiveInspectionNotification} from '../domain/inspectionNotificationAudience.mjs';
import { syncInspectorRoster } from '../integrations/dingtalk/inspectorRoster.mjs';
import { notificationConfiguration } from '../integrations/dingtalk/notifications.mjs';
const needsAudience=(task,latestEventId,eventId)=>hasPendingInspection(task)&&!task.inspectorId&&String(latestEventId)===String(eventId);
export async function processInspectionNotifications({database=pool,runTransaction=transaction,sync=syncInspectorRoster,env=process.env}={}) {
  const lease=randomUUID();
  const {rows}=await database.query(`with candidate as (
    select event_id from dispatch_inspection_notifications where status='pending' and next_attempt_at<=now() and (locked_until is null or locked_until<now()) order by event_id for update skip locked limit 1
  ) update dispatch_inspection_notifications j set lease_id=$1,locked_until=now()+interval '5 minutes',attempts=attempts+1 from candidate c where j.event_id=c.event_id returning j.*`,[lease]);
  const job=rows[0];if(!job) return false;
  try {
    const snapshot=await inspectionNotificationSnapshot(database,job);
    const shopId=snapshot?.task.shopId;if(!shopId) throw new Error('维修任务不存在');
    const mode=notificationConfiguration(env);
    const loadIds=async()=>{const result=await sync(shopId);if(!Array.isArray(result))throw new Error('检验员名单响应无效');return result;};
    let ids=mode==='dingtalk'&&snapshot.leaseId===lease&&needsAudience(snapshot.task,snapshot.latestEventId,job.event_id)?await loadIds():undefined;
    const resolve=()=>runTransaction(async client=>{
      // Lock the parent in the same order as every task mutation.
      const {rows:parents}=await client.query('select id,vehicle_plate,dispatch_no,status,shop_id from work_orders where id=$1 for update',[job.order_id]);
      const {rows:tasks}=await client.query('select * from dispatch_tasks where order_id=$1',[job.order_id]);
      const {rows:current}=await client.query('select lease_id from dispatch_inspection_notifications where event_id=$1 for update',[job.event_id]);
      if(current[0]?.lease_id!==lease) return;
      const task=mapTask({...parents[0],...tasks[0],order_id:job.order_id,order_status:parents[0]?.status,repair_items:[]});
      // Claim release also queues inspection work. Only a newer inspection job
      // supersedes this one; unrelated edits must not cancel an actionable notice.
      const {rows:events}=await client.query(`select max(id) as id from dispatch_events where order_id=$1
        and exists(select 1 from dispatch_inspection_notifications n where n.event_id=dispatch_events.id)`,[job.order_id]);
      if(!needsAudience(task,events[0]?.id,job.event_id)) {
        await client.query("update dispatch_inspection_notifications set status='obsolete',locked_until=null,lease_id=null where event_id=$1",[job.event_id]);return;
      }
      if(task.shopId!==shopId)throw new Error('任务门店已变化，请重新同步检验员');
      // A previously obsolete-looking task may become actionable before the
      // lock. Release the transaction and discover its live audience first.
      if(mode==='dingtalk'&&ids===undefined)return true;
      const people=await localDispatchPeople({shopId},client);
      const recipients=people.filter(p=>canReceiveInspectionNotification(task,p) && (!ids || ids.includes(p.id)));
      if(!recipients.length) throw new Error('暂无本店可独立检验的检验员，请检查钉钉角色、员工状态及维修参与情况后重试');
      for(const p of recipients) {
       if(await hasSubmissionNotification(client,job.order_id,job.event_id,p.id))continue;
       await client.query(`insert into dispatch_notifications(id,order_id,event_id,recipient_id,kind,payload) values($1,$2,$3,$4,'待检验',$5) on conflict(event_id,recipient_id,kind) do nothing`,[randomUUID(),job.order_id,job.event_id,p.id,JSON.stringify({orderId:job.order_id,plate:task.plate,dispatchNo:task.dispatchNo,summary:task.items.map(i=>i.name).join('、').slice(0,200),dueAt:task.dueAt})]);
      }
      await client.query("update dispatch_inspection_notifications set status='ready',error='',locked_until=null,lease_id=null where event_id=$1",[job.event_id]);
    });
    if(await resolve()){ids=await loadIds();await resolve();}
  } catch(error) {
    await database.query(`update dispatch_inspection_notifications set status=case when attempts<5 then 'pending' else 'failed' end,error=$3,next_attempt_at=now()+interval '1 minute',locked_until=null,lease_id=null where event_id=$1 and lease_id=$2`,[job.event_id,lease,error.message||'检验员同步失败']);
  }
  return true;
}
