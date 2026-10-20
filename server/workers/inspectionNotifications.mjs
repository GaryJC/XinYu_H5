import { randomUUID } from 'node:crypto';
import { pool,transaction } from '../database/pool.mjs';
import { mapTask, dispatchPeople } from '../repositories/dispatchRepository.mjs';
import { canInspect } from '../domain/dispatchPolicy.mjs';
import { syncInspectorRoster } from '../integrations/dingtalk/inspectorRoster.mjs';
import { notificationConfiguration } from '../integrations/dingtalk/notifications.mjs';
export async function processInspectionNotifications({database=pool,runTransaction=transaction,sync=syncInspectorRoster,env=process.env}={}) {
  const lease=randomUUID();
  const {rows}=await database.query(`with candidate as (
    select event_id from dispatch_inspection_notifications where status='pending' and next_attempt_at<=now() and (locked_until is null or locked_until<now()) order by event_id for update skip locked limit 1
  ) update dispatch_inspection_notifications j set lease_id=$1,locked_until=now()+interval '5 minutes',attempts=attempts+1 from candidate c where j.event_id=c.event_id returning j.*`,[lease]);
  const job=rows[0];if(!job) return false;
  try {
    const {rows:orders}=await database.query('select shop_id from dispatch_tasks where order_id=$1',[job.order_id]);
    const shopId=orders[0]?.shop_id;if(!shopId) throw new Error('维修任务不存在');
    const mode=notificationConfiguration(env);
    const ids=mode==='dingtalk'?await sync(shopId):undefined;
    await runTransaction(async client=>{
      // Lock the parent in the same order as every task mutation.
      const {rows:parents}=await client.query('select id,vehicle_plate,dispatch_no,status,shop_id from work_orders where id=$1 for update',[job.order_id]);
      const {rows:tasks}=await client.query('select * from dispatch_tasks where order_id=$1',[job.order_id]);
      const {rows:current}=await client.query('select lease_id from dispatch_inspection_notifications where event_id=$1 for update',[job.event_id]);
      if(current[0]?.lease_id!==lease) return;
      const task=mapTask({...parents[0],...tasks[0],order_id:job.order_id,order_status:parents[0]?.status,repair_items:[]});
      const {rows:events}=await client.query("select max(id) as id from dispatch_events where order_id=$1 and action in ('submit-order','retry-inspection-notifications')",[job.order_id]);
      if(task.stage!=='待检验' || task.inspectorId || String(events[0]?.id)!==String(job.event_id)) {
        await client.query("update dispatch_inspection_notifications set status='obsolete',locked_until=null,lease_id=null where event_id=$1",[job.event_id]);return;
      }
      const people=await dispatchPeople({shopId},client);
      const recipients=people.filter(p=>canInspect(task,p) && (ids?ids.includes(p.id):p.role==='inspector'));
      if(!recipients.length) throw new Error('暂无本店合资格检验员，请检查钉钉角色和员工状态后重试');
      for(const p of recipients) await client.query(`insert into dispatch_notifications(id,order_id,event_id,recipient_id,kind,payload) values($1,$2,$3,$4,'待检验',$5) on conflict(event_id,recipient_id,kind) do nothing`,[randomUUID(),job.order_id,job.event_id,p.id,JSON.stringify({orderId:job.order_id,plate:task.plate,dispatchNo:task.dispatchNo,summary:task.items.map(i=>i.name).join('、').slice(0,200),dueAt:task.dueAt})]);
      await client.query("update dispatch_inspection_notifications set status='ready',error='',locked_until=null,lease_id=null where event_id=$1",[job.event_id]);
    });
  } catch(error) {
    await database.query(`update dispatch_inspection_notifications set status=case when attempts<5 then 'pending' else 'failed' end,error=$3,next_attempt_at=now()+interval '1 minute',locked_until=null,lease_id=null where event_id=$1 and lease_id=$2`,[job.event_id,lease,error.message||'检验员同步失败']);
  }
  return true;
}
