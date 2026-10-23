import { pool } from '../database/pool.mjs';

export async function listInspectionReturns(shopId, range, client = pool) {
  const { rows } = await client.query(`
    select e.order_id as "orderId", e.detail
    from dispatch_events e
    join work_orders wo on wo.id = e.order_id
    where wo.shop_id = $1 and e.action = 'inspect'
      and e.at >= $2::timestamptz and e.at < $3::timestamptz
      and jsonb_array_length(coalesce(e.detail->'rejectedItemIds', '[]'::jsonb)) > 0
  `, [shopId, range.from, range.to]);
  return rows;
}
