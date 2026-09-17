import { pendingDispatchPlan, markDispatchPlan } from '../repositories/dispatchPlanRepository.mjs';
import { dispatchPeople, executeDispatchActionInTransaction } from './dispatchService.mjs';

// Called inside the signature transaction: signature, repair task and outboxes commit together.
export async function activateDispatchPlan(client,order) {
  const plan=await pendingDispatchPlan(client,order.id);
  if (!plan) return;
  const data=plan.execution_data||{};
  const ids=data.technicianIds??(plan.technician_id?[plan.technician_id]:[]);
  await client.query('select id from users where id=any($1::text[]) order by id for share',[[plan.assigned_by,...ids]]);
  const people=await dispatchPeople({shopId:order.shop.id},client);
  const actor=people.find(p=>p.id===plan.assigned_by && p.active && ['advisor','manager'].includes(p.role));
  const validWorkers=ids.every(id=>people.some(p=>p.id===id && p.active && p.role==='technician')); 
  if (!actor || !validWorkers || (data.executionMode!=='outsourced' && !ids.length)) {
    await markDispatchPlan(client,order.id,'预选维修工或指派人已停用、转店或权限变更，请服务顾问在派工台重新指派');
    return;
  }
  await executeDispatchActionInTransaction(client,actor,order.id,{...data,action:'assign',expectedVersion:0,requestId:`signature-${order.id}`,technicianIds:ids,dueAt:plan.due_at.toISOString(),urgent:plan.urgent,note:plan.note});
  await markDispatchPlan(client,order.id);
}
