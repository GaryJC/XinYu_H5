import {hasPendingInspection} from '../../shared/repairProgress.mjs';
import { hasRole, hasAnyRole } from "../../shared/roles.mjs";
import { outsourcingMembership } from './outsourcingMembership.mjs';
import {readRepairWriteback} from './repairWritebackRepository.mjs';
import { readRepairRounds } from './repairRoundRepository.mjs';
import { pool } from '../database/pool.mjs';
import { HttpError } from '../http/HttpError.mjs';
import { assertDispatchAccess, canInspect, dispatchMetric, technicianIds } from '../domain/dispatchPolicy.mjs';
const projection = `select wo.id as order_id, wo.shop_id, wo.vehicle_plate, wo.dispatch_no, wo.arrival_date,
  (select count(*)::integer from jsonb_array_elements(wo.pending_repairs) p where p->>'state'='pending' and coalesce(p->>'source','customer')<>'inspection') as pending_repair_count,
  (select count(*)::integer from jsonb_array_elements(wo.pending_repairs) p where p->>'source'='inspection' and p->>'inspectionState' in ('pending','scheduled')) as inspection_deferred_count,
  wo.vehicle_vin,wo.vehicle_model,wo.vehicle_mileage,wo.customer_name,wo.advisor,wo.status as order_status, wo.fault_description, wo.technician as legacy_technician,
  exists(select 1 from dispatch_events e where e.order_id=wo.id and e.action in ('accept','record-parts','edit-parts') and e.detail->'partsRequirement' is not null) as has_parts_history,
  dt.technician_id, dt.inspector_id, dt.stage, dt.version, dt.data,
  coalesce((select jsonb_agg(jsonb_build_object('id',ri.client_item_id,'name',ri.name,
    'status',ri.status,'startAt',nullif(ri.start_at,''),'finishAt',nullif(ri.finish_at,'')) order by ri.item_no)
    from repair_items ri where ri.order_id=wo.id),'[]'::jsonb) as repair_items
  from work_orders wo left join dispatch_tasks dt on dt.order_id=wo.id`;
export function mapTask(row) {
  const task = { hasPartsHistory:Boolean(row.has_parts_history), items:row.repair_items, ...row.data, vehicleVin:row.vehicle_vin||'',vehicleModel:row.vehicle_model||'',vehicleMileage:row.vehicle_mileage||'',customerName:row.customer_name||'',advisor:row.advisor||'', orderId:row.order_id, shopId:row.shop_id,
    technicianId:row.technician_id || undefined, inspectorId:row.inspector_id || undefined,
    stage:['草稿','待客户签字'].includes(row.order_status)?row.order_status:row.stage || (['待结算','完成'].includes(row.order_status)?'维修完成':row.order_status==='维修中'?'维修中':'待派工'),
    version:row.version || 0, plate:row.vehicle_plate, dispatchNo:row.dispatch_no || '', arrivalDate:row.arrival_date,
    pendingRepairCount:row.pending_repair_count||0, inspectionDeferredCount:row.inspection_deferred_count||0, orderStatus:row.order_status, faultDescription:row.fault_description };
  const ids=task.technicianIds??(task.technicianId?[task.technicianId]:[]);
  if(ids.length===1)task.items=task.items.map(item=>({...item,responsibleId:item.responsibleId||ids[0],responsibleName:item.responsibleName||(item.responsibleId&&item.responsibleId!==ids[0]?undefined:task.technicianName)}));
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
// Recheck queued inspection messages against the current task before delivery.
export async function validateInspectionRecipient(notification, user, client=pool) {
  if(!user?.active) return false;
  const {rows}=await client.query(`${projection} where wo.id=$1`,[notification.order_id]);
  if(!rows[0]) return false;
  const task=mapTask(rows[0]);
  return hasPendingInspection(task) && !task.needsReview && (!task.inspectorId || task.inspectorId===user.id) && Boolean(canInspect(task,user));
}
export async function listDispatchTasks(actor, client=pool) {
  if(!actor?.active || !hasAnyRole(actor, ['manager','advisor','technician','inspector','warehouse','outsourcing'])) throw new HttpError(403,'无权访问派工模块');
  const {rows}=await client.query(`${projection} where wo.shop_id=$1 and wo.status <> '待处理纸质委托书'
    order by coalesce((dt.data->>'urgent')::boolean,false) desc,
      nullif(dt.data->>'dueAt','')::timestamptz asc nulls last, wo.arrival_date asc, wo.id asc`, [actor.shopId]);
  return rows.map(mapTask).filter(task => {
    try { assertDispatchAccess(task, actor); return true; }
    catch (error) { if (error.status === 403) return false; throw error; }
  });
}
export async function dispatchPeople(actor, client=pool) {
  const {rows}=await client.query(`select id,name,role,active,shop_id,inspector_role_member, roles, ${outsourcingMembership} from users where shop_id=$1 order by name,id`,[actor.shopId]);
  return rows.map(r=>({id:r.id,name:r.name,role:r.role,roles:r.roles,active:r.active,shopId:r.shop_id,inspectorRoleMember:r.inspector_role_member,outsourcingRoleMember:r.outsourcing_role_member}));
}
export async function saveDispatchTask(client, task, { metadataOnly = false, techniciansOnly = false } = {}) {
  const {inspectionDeferredCount,hasPartsHistory,pendingRepairCount,orderId,shopId,technicianId,inspectorId,stage,version,plate,dispatchNo,arrivalDate,orderStatus,faultDescription,overdue,repairCatalog,vehicleVin,vehicleModel,vehicleMileage,customerName,advisor,...data}=task;
  await client.query(`insert into dispatch_tasks(order_id,shop_id,technician_id,inspector_id,stage,version,data)
    values($1,$2,$3,$4,$5,$6,$7) on conflict(order_id) do update set technician_id=excluded.technician_id,
    inspector_id=excluded.inspector_id,stage=excluded.stage,version=excluded.version,data=excluded.data,updated_at=now()`,
    [orderId,shopId,technicianId||null,inspectorId||null,stage,version,JSON.stringify(data)]);
  if(techniciansOnly) {
    await client.query('update work_orders set technician=$2,updated_at=now() where id=$1',[orderId,task.technicianName]);
    return;
  }
  if(task.settlementAssignment&&orderStatus!=='完成'&&!metadataOnly) await client.query('update work_orders set status=$2 where id=$1',[orderId,stage==='维修完成'?'待结算':'维修中']);
  if(metadataOnly || task.repairRound) {
    await client.query('update work_orders set updated_at=now() where id=$1',[orderId]);
    return; // Date-only edits and subsequent rounds must not rewrite order status or original repair_items.
  }
  const started=task.firstStartedAt || task.startHistoryUnknown || task.items.some(i=>i.startAt || ['维修中','待检验','已完工'].includes(i.status));
  const status=task.settlementAssignment&&orderStatus!=='完成'?(stage==='维修完成'?'待结算':'维修中'):stage==='维修完成'?(orderStatus==='完成'?'完成':'待结算'):started?'维修中':'待派工';
  await client.query(`update work_orders set status=$2,technician=$3,inspector=$4,updated_at=now() where id=$1`,[orderId,status,task.technicianName||'待派工',task.inspectorName||'待检验']);
  await client.query('delete from repair_items where order_id=$1 and not (client_item_id=any($2::bigint[]))',[orderId,[...task.items,...(task.deferredItems||[])].map(item=>item.id)]);
  for(const [index,item] of task.items.entries()) await client.query(`insert into repair_items(order_id,client_item_id,item_no,name) values($1,$2,$3,$4)
    on conflict(order_id,client_item_id) do update set name=excluded.name,item_no=excluded.item_no`,[orderId,item.id,index+1,item.name]);
  for(const item of task.items) await client.query(`update repair_items set owner=$3,status=$4,start_at=$5,finish_at=$6,inspector=$7 where order_id=$1 and client_item_id=$2`,[orderId,item.id,item.responsibleName||task.technicianName||'待派工',item.status,item.startAt||'',item.finishAt||'',item.inspectorName||'待检验']);
}
export async function dispatchDetail(actor,id,client=pool) {
  const task=await getDispatchTask(client,id,actor);
  const {rows:events}=await client.query('select id,actor_name,action,detail,at from dispatch_events where order_id=$1 order by id desc',[id]);
  const {rows:notifications}=await client.query(`select n.id,n.kind,n.status,n.error,n.created_at,n.attempts,n.task_id,u.name
    from dispatch_notifications n join users u on u.id=n.recipient_id where n.order_id=$1
    ${hasAnyRole(actor, ['manager','advisor'])?'':'and n.recipient_id=$2'} order by n.created_at desc`,hasAnyRole(actor, ['manager','advisor'])?[id]:[id,actor.id]);
  const {rows:files}=await client.query("select repair_round,id,kind,original_name,mime_type,size_bytes,created_at,uploaded_by,(select name from users where users.id=files.uploaded_by) as uploaded_name from files where order_id=$1 and kind in ('repair_completed_photo','repair_parts_photo','repair_progress_photo','repair_order_photo','damage_photo','other') order by created_at",[id]);
  const {rows:jobs}=await client.query('select status,error from dispatch_inspection_notifications where order_id=$1 order by event_id desc limit 1',[id]);
  const schedulerNotifications=hasAnyRole(actor, ['manager','advisor'])?(await client.query('select event_id::text as "eventId",kind,status,error from dispatch_scheduler_notifications where order_id=$1 order by event_id desc limit 20',[id])).rows:undefined;
  const repairRounds=await readRepairRounds(client,id);
  const catalog=new Map();
  for(const r of repairRounds) for(const i of r.task.items) catalog.set(i.id,{id:i.id,name:i.name});
  for(const i of task.items) catalog.set(i.id,{id:i.id,name:i.name});
  task.repairCatalog=[...catalog.values()];
  return {task,repairWriteback:await readRepairWriteback(client,id),repairRounds,schedulerNotifications,inspectionNotification:jobs[0],events:events.map(r=>({id:String(r.id),actorName:r.actor_name,action:r.action,detail:r.detail,at:r.at.toISOString()})),
    notifications:notifications.map(r=>({id:r.id,kind:r.kind,status:r.status,error:r.error,createdAt:r.created_at.toISOString(),attempts:r.attempts,taskId:r.task_id,recipientName:r.name})),
    files:files.map(r=>({repairRound:r.repair_round,uploadedBy:r.uploaded_by,uploadedName:r.uploaded_name,id:r.id,orderId:id,kind:r.kind,originalName:r.original_name,mimeType:r.mime_type,sizeBytes:Number(r.size_bytes),createdAt:r.created_at.toISOString()}))};
}

export async function assertInspectionCompleted(client,orderId) {
  const {rows}=await client.query('select stage from dispatch_tasks where order_id=$1',[orderId]);
  if(rows[0]?.stage!=='维修完成') throw new HttpError(409,'请先完成维修检验再完结工单');
}

export async function assertRepairPhotoRecorded(client,task,ownerId) {
  const {rows}=await client.query("select 1 from files where order_id=$1 and kind in ('repair_progress_photo','repair_completed_photo') and coalesce(repair_round,0)=$2 and ($3::text is null or uploaded_by=$3) limit 1",[task.orderId,task.repairRound||0,ownerId||null]);
  if(!rows.length) throw new HttpError(409,'请先上传至少一张本轮维修照片，再提交完工');
}
