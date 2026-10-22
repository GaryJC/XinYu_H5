import {randomUUID} from 'node:crypto';
import {mapTask} from './dispatchRepository.mjs';
export async function dueReminderCandidates(client,now) {
  const {rows}=await client.query(`select wo.id as order_id,wo.shop_id,wo.vehicle_plate,wo.dispatch_no,wo.status as order_status,
    dt.technician_id,dt.inspector_id,dt.stage,dt.version,dt.data,'[]'::jsonb as repair_items
    from work_orders wo join dispatch_tasks dt on dt.order_id=wo.id
    where dt.stage in ('待接单','待开工','维修中','暂停') and wo.status not in ('草稿','待客户签字') and (wo.status not in ('待结算','完成') or (dt.data->>'repairRound')::integer>0)
      and coalesce(dt.data->>'executionMode','internal')<>'outsourced'
      and not coalesce((dt.data->>'needsReview')::boolean,false) and coalesce(dt.data->>'feedback','')=''
      and nullif(dt.data->>'dueAt','')::timestamptz>$1::timestamptz
      and nullif(dt.data->>'dueAt','')::timestamptz<=$1::timestamptz+interval '48 hours'
      and exists(select 1 from users u where u.active and (u.role='technician' or 'technician'=any(u.roles)) and u.shop_id=wo.shop_id
        and (dt.technician_id=u.id or dt.data->'technicianIds' ? u.id)
        and not exists(select 1 from dispatch_due_reminders r where r.order_id=wo.id and r.recipient_id=u.id
          and r.repair_round=coalesce((dt.data->>'repairRound')::integer,0) and r.due_at=(dt.data->>'dueAt')::timestamptz
          and r.lead_minutes=case when (dt.data->>'dueAt')::timestamptz<=$1::timestamptz+interval '1 hour' then 60
            when (dt.data->>'dueAt')::timestamptz<=$1::timestamptz+interval '24 hours' then 1440 else 2880 end))
    order by (dt.data->>'dueAt')::timestamptz,wo.id limit 100 for update of wo skip locked`,[new Date(now).toISOString()]);
  return rows.map(mapTask);
}
export async function queueDueReminder(client,task,recipients,leadMinutes) {
  const {rows:existing}=await client.query('select recipient_id from dispatch_due_reminders where order_id=$1 and due_at=$2::timestamptz and lead_minutes=$3 and repair_round=$4',[task.orderId,task.dueAt,leadMinutes,task.repairRound||0]);
  const targets=recipients.filter(p=>!existing.some(r=>r.recipient_id===p.id));
  if(!targets.length)return 0;
  const {rows:[event]}=await client.query(`insert into dispatch_events(order_id,actor_id,actor_name,request_id,request_body,action,detail)
    values($1,null,'系统提醒',$2,$3,'due-reminder',$4) returning id`,[task.orderId,`due-${randomUUID()}`,JSON.stringify({dueAt:task.dueAt,leadMinutes}),JSON.stringify({stage:task.stage,dueAt:task.dueAt,leadMinutes})]);
  const windowText=leadMinutes===2880?'2天':leadMinutes===1440?'1天':'1小时';
  const payload={repairRound:task.repairRound||0,orderId:task.orderId,plate:task.plate,dispatchNo:task.dispatchNo,summary:task.items.map(i=>i.name).join('、').slice(0,200),dueAt:task.dueAt,leadMinutes,notice:`工单将在${windowText}内到期，请尽快处理。`};
  for(const p of targets) {
    await client.query('insert into dispatch_due_reminders(order_id,recipient_id,due_at,lead_minutes,event_id,repair_round) values($1,$2,$3,$4,$5,$6)',[task.orderId,p.id,task.dueAt,leadMinutes,event.id,task.repairRound||0]);
    await client.query(`insert into dispatch_notifications(id,order_id,event_id,recipient_id,kind,payload) values($1,$2,$3,$4,'即将到期',$5)`,[randomUUID(),task.orderId,event.id,p.id,JSON.stringify(payload)]);
  }
  return targets.length;
}
