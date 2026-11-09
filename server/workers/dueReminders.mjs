import {transaction,pool} from '../database/pool.mjs';
import {dispatchPeople,mapTask} from '../repositories/dispatchRepository.mjs';
import {dueReminderCandidates,queueDueReminder} from '../repositories/dueReminderRepository.mjs';
import {dueReminderWindow,dueReminderRecipients,isCurrentDueReminder} from '../domain/dueReminderPolicy.mjs';
export async function queueDueReminders({runTransaction=transaction,now=Date.now(),candidates=dueReminderCandidates,people=dispatchPeople,queue=queueDueReminder}={}) {
  return runTransaction(async client=>{
    let count=0;
    // One fresh roster per shop for this atomic batch (at most 100 candidates).
    // Never carry it into another scan; delivery still rechecks each recipient.
    const rosters=new Map();
    for(const task of await candidates(client,now)) {
      const lead=dueReminderWindow(task,now);
      if(!lead)continue;
      if(!rosters.has(task.shopId))rosters.set(task.shopId,await people({shopId:task.shopId},client));
      const recipients=dueReminderRecipients(task,rosters.get(task.shopId),now);
      count+=await queue(client,task,recipients,lead);
    }
    return count;
  });
}
export async function validateDueReminder(notification,user,{database=pool,now=Date.now()}={}) {
  const {rows}=await database.query(`select wo.id as order_id,wo.shop_id,wo.vehicle_plate,wo.dispatch_no,wo.status as order_status,
    dt.technician_id,dt.inspector_id,dt.stage,dt.version,dt.data,'[]'::jsonb as repair_items
    from dispatch_tasks dt join work_orders wo on wo.id=dt.order_id where dt.order_id=$1`,[notification.order_id]);
  return Boolean(rows[0] && user && isCurrentDueReminder(mapTask(rows[0]),notification,user,now));
}
