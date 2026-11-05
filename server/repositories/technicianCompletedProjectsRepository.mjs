import { pool } from '../database/pool.mjs';

export async function readCompletedProjectSnapshots(shopId, userId, client = pool) {
  const { rows } = await client.query(`
    with snapshots as (
      select wo.id as order_id, wo.vehicle_plate, wo.dispatch_no,
        coalesce((dt.data->>'repairRound')::integer,0) as round_no,
        jsonb_build_object('technicianId',dt.technician_id,'items',coalesce(
          (select jsonb_agg(jsonb_build_object('id',ri.client_item_id,'name',ri.name,'status',ri.status))
           from repair_items ri where ri.order_id=wo.id),'[]'::jsonb)) || dt.data as snapshot
      from work_orders wo join dispatch_tasks dt on dt.order_id=wo.id
      where wo.shop_id=$1
      union all
      select wo.id,wo.vehicle_plate,wo.dispatch_no,r.round_no,r.snapshot
      from dispatch_repair_rounds r join work_orders wo on wo.id=r.order_id
      join dispatch_tasks dt on dt.order_id=wo.id
      where wo.shop_id=$1 and r.round_no<>coalesce((dt.data->>'repairRound')::integer,0)
    )
    select * from snapshots where
      snapshot->'items' @> jsonb_build_array(jsonb_build_object('responsibleId',$2::text,'status','已完工'))
      or snapshot->'technicianIds' = jsonb_build_array($2::text)
      or (nullif(snapshot->'technicianIds','null'::jsonb) is null and snapshot->>'technicianId'=$2)
  `, [shopId, userId]);
  return rows;
}
