import { pool } from '../database/pool.mjs';

// Restrict historical rows in SQL before reading JSON work-in-progress fields.
// Legacy orders may have repair_items without a dispatch JSON item list.
export async function readOnsiteData(shopId, now, month, database = pool) {
  const orders = await database.query(`
      select wo.id as "orderId", wo.status as "orderStatus", wo.created_at as "createdAt",
        wo.vehicle_plate as plate, coalesce(wo.dispatch_no,'') as "dispatchNo",
        case when wo.status='待客户签字' then wo.status
          else coalesce(dt.stage, case when wo.status='维修中' then wo.status else '待派工' end) end as stage,
        dt.technician_id as "technicianId", dt.data->'technicianIds' as "technicianIds",
        dt.data->>'technicianName' as "technicianName", dt.data->>'dueAt' as "dueAt",
        dt.data->'needsReview' as "needsReview", dt.data->>'executionMode' as "executionMode",
        dt.data->>'contractor' as contractor, dt.data->'partsRequirement' as "partsRequirement",
        dt.data->'partsRequests' as "partsRequests", dt.data->'workerPauses' as "workerPauses",
        coalesce(nullif(dt.data->'items','null'::jsonb),
          (select jsonb_agg(jsonb_build_object('id',ri.client_item_id,'name',ri.name,
            'status',ri.status,'finishAt',nullif(ri.finish_at,'')) order by ri.item_no)
           from repair_items ri where ri.order_id=wo.id),'[]'::jsonb) as items
      from work_orders wo left join dispatch_tasks dt on dt.order_id=wo.id and dt.shop_id=wo.shop_id
      where wo.shop_id=$1 and wo.created_at<=$2
        and wo.status not in ('草稿','待处理纸质委托书')
        and (wo.status='待客户签字' or dt.stage<>'维修完成'
          or (dt.stage is null and wo.status not in ('待结算','完成','维修完成')))`,
      [shopId, now]);
  const { rows: [summary] } = await database.query(`select
      (select coalesce(json_agg(json_build_object('id',id,'name',name)),'[]'::json)
         from users where shop_id=$1) as people,
      count(*)::integer as "tripCount", count(proxy_returned_by)::integer as "missedReturnCount"
      from vehicle_trip_requests where shop_id=$1
        and departure_at >= ($2::date::timestamp at time zone 'Asia/Shanghai')
        and departure_at < (($2::date + interval '1 month') at time zone 'Asia/Shanghai')`,
      [shopId, month + '-01']);
  return { orders: orders.rows, people: summary.people,
    vehicle: { month, tripCount: summary.tripCount, missedReturnCount: summary.missedReturnCount } };
}
