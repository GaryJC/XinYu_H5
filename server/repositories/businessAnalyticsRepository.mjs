import {pool} from '../database/pool.mjs';

// Read only analytical fields; photos, signatures and customer contact details are excluded.
export async function readBusinessAnalyticsOrders(actor, client=pool) {
  const {rows}=await client.query(`select wo.id, wo.created_at, wo.status, wo.customer_name,
    wo.vehicle_plate, wo.vehicle_vin, dt.stage, dt.data->>'completedAt' as completed_at,
    dt.data->>'executionMode' as execution_mode,
    (select min(e.at) from dispatch_events e where e.order_id=wo.id and e.detail->>'stage'='维修完成') as first_completion_event,
    (select min(r.completed_at) from dispatch_repair_rounds r where r.order_id=wo.id) as first_round_completion
    from work_orders wo left join dispatch_tasks dt on dt.order_id=wo.id
    where wo.shop_id=$1`,[actor.shopId]);
  return rows.map(r=>({id:r.id,createdAt:r.created_at,status:r.status,stage:r.stage,
    customer:r.customer_name,plate:r.vehicle_plate,vin:r.vehicle_vin,executionMode:r.execution_mode,
    completionDates:[r.first_completion_event,r.first_round_completion,r.completed_at]}));
}
