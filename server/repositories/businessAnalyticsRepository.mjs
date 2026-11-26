import { pool } from '../database/pool.mjs';

// Select scalar fields only. A task can contain photo, signature and contact data.
export async function readBusinessAnalyticsOrders(actor, client = pool, filter) {
  const values = [actor.shopId];
  let dateFilter = '';
  let completionFilter = '';
  if (filter) {
    values.push(new Date(filter.start).toISOString(), new Date(filter.end).toISOString());
    if (filter.metric === 'orders') {
      dateFilter = 'and wo.created_at >= $2::timestamptz and wo.created_at < $3::timestamptz';
    } else {
      dateFilter = 'and wo.created_at < $3::timestamptz';
      // A valid earlier event or round disqualifies rework in this month. Leave
      // legacy task timestamps to the same parser used by the summary.
      completionFilter = `where (first_completion_event is null or first_completion_event >= $2::timestamptz)
        and (first_round_completion is null or first_round_completion >= $2::timestamptz)
        and (first_completion_event < $3::timestamptz or first_round_completion < $3::timestamptz
          or nullif(completed_at, '') is not null)`;
    }
  }
  const { rows } = await client.query(`with candidates as (
    select wo.id, wo.created_at, wo.status, wo.dispatch_no, wo.customer_name,
      wo.vehicle_plate, wo.vehicle_vin, dt.stage, dt.data->>'completedAt' as completed_at,
      dt.data->>'executionMode' as execution_mode,
      event.first_completion_event, round.first_round_completion
    from work_orders wo
    left join dispatch_tasks dt on dt.order_id = wo.id and dt.shop_id = wo.shop_id
    left join lateral (
      select min(e.at) as first_completion_event from dispatch_events e
      where e.order_id = dt.order_id and e.detail->>'stage' = '维修完成' and e.at >= wo.created_at
    ) event on true
    left join lateral (
      select min(r.completed_at) as first_round_completion from dispatch_repair_rounds r
      where r.order_id = wo.id and r.completed_at >= wo.created_at
        and coalesce(r.snapshot->>'shopId', wo.shop_id) = wo.shop_id
        and (dt.order_id is not null or not exists (
          select 1 from dispatch_tasks owner where owner.order_id = wo.id
        ))
    ) round on true
    where wo.shop_id = $1 and wo.status not in ('草稿','待处理纸质委托书') ${dateFilter}
  ) select * from candidates ${completionFilter}`, values);
  return rows.map(row => ({
    id: row.id, createdAt: row.created_at, status: row.status, stage: row.stage,
    dispatchNo: row.dispatch_no, customer: row.customer_name, plate: row.vehicle_plate,
    vin: row.vehicle_vin, executionMode: row.execution_mode,
    completionDates: [row.first_completion_event, row.first_round_completion, row.completed_at]
  }));
}
