import {randomUUID} from 'node:crypto';
import {pool,transaction} from '../database/pool.mjs';
import {dispatchPeople} from '../repositories/dispatchRepository.mjs';
import {syncSchedulerRoster} from '../integrations/dingtalk/schedulerRoster.mjs';
import {notificationConfiguration} from '../integrations/dingtalk/notifications.mjs';
export async function processSchedulerNotifications({database=pool,runTransaction=transaction,sync=syncSchedulerRoster,env=process.env}={}) {
  const lease=randomUUID();
  const {rows}=await database.query(`with candidate as (
    select event_id from dispatch_scheduler_notifications where status='pending' and next_attempt_at<=now() and (locked_until is null or locked_until<now()) order by event_id for update skip locked limit 1
  ) update dispatch_scheduler_notifications j set lease_id=$1,locked_until=now()+interval '5 minutes',attempts=attempts+1 from candidate c where j.event_id=c.event_id returning j.*`,[lease]);
  const job=rows[0];if(!job)return false;
  try {
    const {rows:tasks}=await database.query('select shop_id from dispatch_tasks where order_id=$1',[job.order_id]);
    if(!tasks[0])throw new Error('维修任务不存在');
    const shopId=tasks[0].shop_id;
    const ids=notificationConfiguration(env)==='dingtalk'?await sync(shopId):undefined;
    await runTransaction(async client=>{
      await client.query('select id from work_orders where id=$1 for update',[job.order_id]);
      const {rows:current}=await client.query('select lease_id from dispatch_scheduler_notifications where event_id=$1 for update',[job.event_id]);
      if(current[0]?.lease_id!==lease)return;
      const recipients=(await dispatchPeople({shopId},client)).filter(p=>p.active && ['advisor','manager'].includes(p.role) && (!ids || ids.includes(p.id)));
      if(!recipients.length)throw new Error('暂无本店有效服务顾问或管理员，请检查钉钉角色后重试');
      for(const p of recipients)await client.query(`insert into dispatch_notifications(id,order_id,event_id,recipient_id,kind,payload) values($1,$2,$3,$4,$5,$6) on conflict(event_id,recipient_id,kind) do nothing`,[randomUUID(),job.order_id,job.event_id,p.id,job.kind,JSON.stringify(job.payload)]);
      await client.query("update dispatch_scheduler_notifications set status='ready',error='',locked_until=null,lease_id=null where event_id=$1",[job.event_id]);
    });
  } catch(error) {
    await database.query(`update dispatch_scheduler_notifications set status=case when attempts<5 then 'pending' else 'failed' end,error=$3,next_attempt_at=now()+interval '1 minute',locked_until=null,lease_id=null where event_id=$1 and lease_id=$2`,[job.event_id,lease,error.message||'派工员通知解析失败']);
  }
  return true;
}

export async function validateSchedulerRecipient(notification,user,{database=pool}={}) {
  if(!user?.active || !['advisor','manager'].includes(user.role))return false;
  const {rows}=await database.query('select shop_id from dispatch_tasks where order_id=$1',[notification.order_id]);
  return Boolean(rows[0] && rows[0].shop_id===user.shopId);
}
