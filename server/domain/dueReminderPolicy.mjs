import { hasAnyRole } from "../../shared/roles.mjs";
import { technicianIds } from './dispatchPolicy.mjs';
export const dueReminderStages=['待接单','待开工','维修中','暂停'];
// Only the currently applicable window is sent. Missed windows are never backfilled in a burst.
export function dueReminderWindow(task,now=Date.now()) {
  if(task.needsReview || task.feedback || task.executionMode==='outsourced' || !dueReminderStages.includes(task.stage) || ['草稿','待客户签字'].includes(task.orderStatus) || !task.repairRound && ['待结算','完成'].includes(task.orderStatus)) return undefined;
  const remaining=Date.parse(task.dueAt)-Number(now);
  if(!Number.isFinite(remaining) || remaining<=0 || remaining>48*3600000) return undefined;
  return remaining<=3600000?60:remaining<=24*3600000?1440:2880;
}
export function dueReminderRecipients(task,people,now=Date.now()) {
  if(!dueReminderWindow(task,now)) return [];
  return people.filter(p=>p.active && (hasAnyRole(p, ['technician','outsourcing'])||p.outsourcingRoleMember) && p.shopId===task.shopId && technicianIds(task).includes(p.id));
}
export function isCurrentDueReminder(task,notification,recipient,now=Date.now()) {
  return (task.repairRound||0)===(notification.payload.repairRound||0) && dueReminderWindow(task,now)===notification.payload.leadMinutes
    && Date.parse(task.dueAt)===Date.parse(notification.payload.dueAt)
    && dueReminderRecipients(task,[recipient],now).length>0;
}
