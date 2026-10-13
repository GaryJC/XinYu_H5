import { applyDispatchAction } from '../domain/dispatchPolicy.mjs';
import { dispatchPeople } from './dispatchRepository.mjs';
import { HttpError } from '../http/HttpError.mjs';

export async function saveDispatchPlan(client, order, actor, plan) {
  if (!plan) {
    await client.query('delete from work_order_dispatch_plans where order_id=$1',[order.id]);
    return;
  }
  if (!actor?.active || !['advisor','manager'].includes(actor.role) || actor.shopId!==order.shop.id) throw new HttpError(403,'无权预先指派维修工');
  const ids=plan.technicianIds??(plan.technicianId?[plan.technicianId]:[]);
  await client.query('select id from users where shop_id=$1 order by id for share',[actor.shopId]);
  const people=await dispatchPeople(actor,client);
  const task=applyDispatchAction({orderId:order.id,shopId:order.shop.id,stage:'待派工',version:0,items:[]}, {...plan,action:'assign',expectedVersion:0,requestId:'validate-draft',technicianIds:ids},actor,people);
  const {technicianId,technicianIds,executionMode,serviceUnit,serviceAddress,serviceContact,departureAt,expectedReturnAt,returnedAt,contractor,outsourcingMode,agreedFee,handedOverAt,receivedAt}=task;
  const data={technicianIds,executionMode,serviceUnit,serviceAddress,serviceContact,departureAt,expectedReturnAt,returnedAt,contractor,outsourcingMode,agreedFee,handedOverAt,receivedAt};
  await client.query(`insert into work_order_dispatch_plans(order_id,technician_id,assigned_by,due_at,urgent,note,execution_data)
    values($1,$2,$3,$4,$5,$6,$7) on conflict(order_id) do update set technician_id=excluded.technician_id,
    assigned_by=excluded.assigned_by,due_at=excluded.due_at,urgent=excluded.urgent,note=excluded.note,execution_data=excluded.execution_data,activation_error='',activated_at=null`,
    [order.id,technicianId||null,actor.id,task.dueAt,task.urgent,task.note,JSON.stringify(data)]);
}
export async function readDispatchPlans(client, ids) {
  const {rows}=await client.query(`select p.*,u.name from work_order_dispatch_plans p left join users u on u.id=p.technician_id where order_id=any($1::text[])`,[ids]);
  return new Map(rows.map(p=>[p.order_id,{...p.execution_data,technicianId:p.technician_id||undefined,technicianName:p.name,dueAt:p.due_at.toISOString(),urgent:p.urgent,note:p.note,activationError:p.activation_error,activatedAt:p.activated_at?.toISOString()}]));
}
export async function pendingDispatchPlan(client,id) {
  return (await client.query('select * from work_order_dispatch_plans where order_id=$1 and activated_at is null for update',[id])).rows[0];
}
export async function markDispatchPlan(client,id,error='') {
  await client.query(`update work_order_dispatch_plans set activation_error=$2,activated_at=case when $2='' then now() else null end where order_id=$1`,[id,error]);
}
