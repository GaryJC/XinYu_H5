import { pool } from '../database/pool.mjs';
import { HttpError } from '../http/HttpError.mjs';
import { assertDispatchAccess, dispatchMetric } from '../domain/dispatchPolicy.mjs';
const projection = `select wo.id as order_id, wo.shop_id, wo.vehicle_plate, wo.dispatch_no, wo.arrival_date,
  wo.status as order_status, wo.fault_description, wo.technician as legacy_technician,
  dt.technician_id, dt.inspector_id, dt.stage, dt.version, dt.data,
  coalesce((select jsonb_agg(jsonb_build_object('id',ri.client_item_id,'name',ri.name,
    'status',ri.status,'startAt',nullif(ri.start_at,''),'finishAt',nullif(ri.finish_at,'')) order by ri.item_no)
    from repair_items ri where ri.order_id=wo.id),'[]'::jsonb) as repair_items
  from work_orders wo left join dispatch_tasks dt on dt.order_id=wo.id`;
export function mapTask(row) {
  const task = { items:row.repair_items, ...row.data, orderId:row.order_id, shopId:row.shop_id,
    technicianId:row.technician_id || undefined, inspectorId:row.inspector_id || undefined,
    stage:['草稿','待客户签字'].includes(row.order_status)?row.order_status:row.stage || (['待结算','完成'].includes(row.order_status)?'维修完成':row.order_status==='维修中'?'维修中':'待派工'),
    version:row.version || 0, plate:row.vehicle_plate, dispatchNo:row.dispatch_no || '', arrivalDate:row.arrival_date,
    orderStatus:row.order_status, faultDescription:row.fault_description };
  task.overdue=dispatchMetric(task,'overdue');
  return task;
}
export async function getDispatchTask(client, id, actor, lock=false) {
  // Always lock the parent first, including initial task creation and legacy endpoints.
  if(lock) await client.query('select id from work_orders where id=$1 for update',[id]);
  const {rows}=await client.query(`${projection} where wo.id=$1`,[id]);
  if(!rows[0]) throw new HttpError(404,'委托单不存在');
  const task=mapTask(rows[0]); assertDispatchAccess(task,actor); return task;
}
export async function listDispatchTasks(actor, client=pool) {
  if(!actor?.active || !['manager','advisor','technician','inspector'].includes(actor.role)) throw new HttpError(403,'无权访问派工模块');
  const restriction=actor.role==='technician'?"and (dt.technician_id=$2 or dt.data->'technicianIds' ? $2)":actor.role==='inspector'?'and dt.inspector_id=$2':'';
  const {rows}=await client.query(`${projection} where wo.shop_id=$1 ${restriction}
    order by coalesce((dt.data->>'urgent')::boolean,false) desc,
      nullif(dt.data->>'dueAt','')::timestamptz asc nulls last, wo.arrival_date asc, wo.id asc`,
    restriction?[actor.shopId,actor.id]:[actor.shopId]);
  return rows.map(mapTask);
}
export async function dispatchPeople(actor, client=pool) {
  const {rows}=await client.query('select id,name,role,active,shop_id from users where shop_id=$1 order by name,id',[actor.shopId]);
  return rows.map(r=>({id:r.id,name:r.name,role:r.role,active:r.active,shopId:r.shop_id}));
}
export async function saveDispatchTask(client, task) {
  const {orderId,shopId,technicianId,inspectorId,stage,version,plate,dispatchNo,arrivalDate,orderStatus,faultDescription,overdue,...data}=task;
  await client.query(`insert into dispatch_tasks(order_id,shop_id,technician_id,inspector_id,stage,version,data)
    values($1,$2,$3,$4,$5,$6,$7) on conflict(order_id) do update set technician_id=excluded.technician_id,
    inspector_id=excluded.inspector_id,stage=excluded.stage,version=excluded.version,data=excluded.data,updated_at=now()`,
    [orderId,shopId,technicianId||null,inspectorId||null,stage,version,JSON.stringify(data)]);
  const started=task.firstStartedAt || task.startHistoryUnknown || task.items.some(i=>i.startAt || ['维修中','待检验','已完工'].includes(i.status));
  const status=stage==='维修完成'?(orderStatus==='完成'?'完成':'待结算'):started?'维修中':'待派工';
  await client.query(`update work_orders set status=$2,technician=$3,inspector=$4,updated_at=now() where id=$1`,[orderId,status,task.technicianName||'待派工',task.inspectorName||'待检验']);
  for(const item of task.items) await client.query(`update repair_items set owner=$3,status=$4,start_at=$5,finish_at=$6,inspector=$7 where order_id=$1 and client_item_id=$2`,[orderId,item.id,task.technicianName||'待派工',item.status,item.startAt||'',item.finishAt||'',item.inspectorName||'待检验']);
}
export async function dispatchDetail(actor,id,client=pool) {
  const task=await getDispatchTask(client,id,actor);
  const {rows:events}=await client.query('select id,actor_name,action,detail,at from dispatch_events where order_id=$1 order by id desc',[id]);
  const {rows:notifications}=await client.query(`select n.id,n.kind,n.status,n.error,n.created_at,n.attempts,n.task_id,u.name
    from dispatch_notifications n join users u on u.id=n.recipient_id where n.order_id=$1
    ${['manager','advisor'].includes(actor.role)?'':'and n.recipient_id=$2'} order by n.created_at desc`,['manager','advisor'].includes(actor.role)?[id]:[id,actor.id]);
  const {rows:files}=await client.query("select id,kind,original_name,mime_type,size_bytes,created_at from files where order_id=$1 and kind in ('repair_order_photo','damage_photo','other') order by created_at",[id]);
  return {task,events:events.map(r=>({id:String(r.id),actorName:r.actor_name,action:r.action,detail:r.detail,at:r.at.toISOString()})),
    notifications:notifications.map(r=>({id:r.id,kind:r.kind,status:r.status,error:r.error,createdAt:r.created_at.toISOString(),attempts:r.attempts,taskId:r.task_id,recipientName:r.name})),
    files:files.map(r=>({id:r.id,orderId:id,kind:r.kind,originalName:r.original_name,mimeType:r.mime_type,sizeBytes:Number(r.size_bytes),createdAt:r.created_at.toISOString()}))};
}

export async function assertWorkHoursRecorded(client,orderId) {
  const {rows}=await client.query('select data from dispatch_tasks where order_id=$1',[orderId]);
  const data=rows[0]?.data;
  if(!Number.isFinite(data?.workHours) || data.workHours<=0 || !data.workHoursRecordedBy || !data.workHoursRecordedAt) throw new HttpError(409,'请先由服务顾问／派单人员在派工台录入实际工时，再完结工单');
}
