import {transaction,pool} from '../database/pool.mjs';
import {dispatchPeople,mapTask} from '../repositories/dispatchRepository.mjs';
import {dueReminderCandidates,queueDueReminder} from '../repositories/dueReminderRepository.mjs';
import {dueReminderWindow,dueReminderRecipients,isCurrentDueReminder} from '../domain/dueReminderPolicy.mjs';
export async function queueDueReminders({runTransaction=transaction,now=Date.now()}={}) {
  return runTransaction(async client=>{
    let count=0;
    for(const task of await dueReminderCandidates(client,now)) {
      const lead=dueReminderWindow(task,now);
      if(!lead)continue;
      const recipients=dueReminderRecipients(task,await dispatchPeople({shopId:task.shopId},client),now);
      count+=await queueDueReminder(client,task,recipients,lead);
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
