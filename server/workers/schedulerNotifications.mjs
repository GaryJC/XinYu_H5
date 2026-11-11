import { hasAnyRole } from "../../shared/roles.mjs";
import {isDispatchNotificationSuppressed} from '../domain/notificationPolicy.mjs';
import {randomUUID} from 'node:crypto';
import {pool,transaction} from '../database/pool.mjs';
import {syncSchedulerRoster} from '../integrations/dingtalk/schedulerRoster.mjs';
import {notificationConfiguration} from '../integrations/dingtalk/notifications.mjs';
export async function processSchedulerNotifications({database=pool,runTransaction=transaction,sync=syncSchedulerRoster,env=process.env}={}) {
  const lease=randomUUID();
  const {rows}=await database.query(`with candidate as (
    select event_id from dispatch_scheduler_notifications where status='pending' and next_attempt_at<=now() and (locked_until is null or locked_until<now()) order by event_id for update skip locked limit 1
  ) update dispatch_scheduler_notifications j set lease_id=$1,locked_until=now()+interval '5 minutes',attempts=attempts+1 from candidate c where j.event_id=c.event_id returning j.*`,[lease]);
  const job=rows[0];if(!job)return false;
  try {
    if(isDispatchNotificationSuppressed(job.kind)) {
      await database.query("update dispatch_scheduler_notifications set status='suppressed',error='',next_attempt_at=null,locked_until=null,lease_id=null where event_id=$1 and lease_id=$2",[job.event_id,lease]);
      return true;
    }
    // Older deployments queued submission notices for schedulers as well as
    // inspectors. Hand these jobs to the inspector-only path without reading
    // or notifying the advisor/manager roster.
    if(['维修已提检','回审已提交'].includes(job.kind)) {
      await runTransaction(async client=>{
        await client.query('select id from work_orders where id=$1 for update',[job.order_id]);
        const {rows:current}=await client.query('select lease_id from dispatch_scheduler_notifications where event_id=$1 for update',[job.event_id]);
        if(current[0]?.lease_id!==lease)return;
        await client.query('insert into dispatch_inspection_notifications(event_id,order_id) values($1,$2) on conflict do nothing',[job.event_id,job.order_id]);
        await client.query("update dispatch_scheduler_notifications set status='ready',error='',locked_until=null,lease_id=null where event_id=$1",[job.event_id]);
      });
      return true;
    }
    const {rows:tasks}=await database.query('select shop_id from dispatch_tasks where order_id=$1',[job.order_id]);
    if(!tasks[0])throw new Error('维修任务不存在');
    const shopId=tasks[0].shop_id;
    const ids=notificationConfiguration(env)==='dingtalk'?await sync(shopId):undefined;
    await runTransaction(async client=>{
      const {rows:orders}=await client.query('select id,advisor from work_orders where id=$1 for update',[job.order_id]);
      const {rows:current}=await client.query('select lease_id from dispatch_scheduler_notifications where event_id=$1 for update',[job.event_id]);
      if(current[0]?.lease_id!==lease)return;
      const {rows:owners}=await client.query("select id from users where active and shop_id=$1 and name=$2 and btrim(name)<>'' and (role in ('advisor','manager') or roles && array['advisor','manager']::text[])",[shopId,orders[0]?.advisor]);
      const recipients=owners.filter(p=>!ids||ids.includes(p.id));
      if(!recipients.length)throw new Error('本单暂无有效经办服务顾问或管理员，请核对经办人及钉钉角色后重试');
      for(const p of recipients) {
       await client.query(`insert into dispatch_notifications(id,order_id,event_id,recipient_id,kind,payload) values($1,$2,$3,$4,$5,$6) on conflict(event_id,recipient_id,kind) do nothing`,[randomUUID(),job.order_id,job.event_id,p.id,job.kind,JSON.stringify(job.payload)]);
      }
      await client.query("update dispatch_scheduler_notifications set status='ready',error='',locked_until=null,lease_id=null where event_id=$1",[job.event_id]);
    });
  } catch(error) {
    await database.query(`update dispatch_scheduler_notifications set status=case when attempts<5 then 'pending' else 'failed' end,error=$3,next_attempt_at=now()+interval '1 minute',locked_until=null,lease_id=null where event_id=$1 and lease_id=$2`,[job.event_id,lease,error.message||'派工员通知解析失败']);
  }
  return true;
}

export async function validateSchedulerRecipient(notification,user,{database=pool}={}) {
  if(!user?.active || user.id!==notification.recipient_id || !hasAnyRole(user, ['advisor','manager']))return false;
  const {rows}=await database.query(`select 1 from work_orders w join users u on u.id=$2
    where w.id=$1 and w.shop_id=$3 and u.shop_id=w.shop_id and u.active
      and u.name=w.advisor and btrim(u.name)<>''
      and (u.role in ('advisor','manager') or u.roles && array['advisor','manager']::text[])`,[notification.order_id,user.id,user.shopId]);
  return rows.length>0;
}
