import { HttpError } from "../http/HttpError.mjs";
import { assertCustomerVehicleEditable, customerVehicleValues } from "../domain/customerVehicleUpdate.mjs";

export async function lockCustomerVehicleOrder(client, id, actor, expectedRevision) {
  const { rows } = await client.query("select * from work_orders where id=$1 for update", [id]);
  if (!rows[0]) throw new HttpError(404, "委托单不存在");
  assertCustomerVehicleEditable(rows[0], actor, expectedRevision);
  // Read without locking events: claim/ACK lock the event before touching the order.
  // We only append new events, never wait on or rewrite a claimed snapshot.
  const latest = await client.query("select revision,event_type,status from legacy_sync_outbox where order_id=$1 order by revision desc limit 1", [id]);
  const event = latest.rows[0];
  if (event ? Number(event.revision) !== expectedRevision || event.status !== rows[0].legacy_sync_status || !["created", "updated"].includes(event.event_type)
    : rows[0].legacy_sync_status !== "synced") throw new HttpError(409, "润丰队列状态不一致，请刷新后核对");
  return rows[0];
}

export async function applyCustomerVehicleUpdate(client, order, input, actor) {
  await client.query(`update work_orders set customer_contact=$2,customer_phone=$3,
    vehicle_model=$4,vehicle_model_legacy_code=$5,customer_name=$6,customer_legacy_code=$7,
    customer_vehicle_updated_at=now(),customer_vehicle_updated_by=$8,updated_at=now() where id=$1`,
  [order.id,input.contact,input.phone,input.model,input.modelLegacyCode,input.organization,input.organizationLegacyCode,actor.name]);
  const { expectedRevision, ...after } = input;
  await client.query("insert into audit_logs(order_id,actor,action) values($1,$2,$3)",
    [order.id, actor.name, `修改联系及车辆信息：${JSON.stringify({ before: customerVehicleValues(order), after })}`]);
}
