import {randomUUID} from 'node:crypto';
import {hasRole} from '../../shared/roles.mjs';

// Caller holds the work-order lock; the file, current pointer and outbox commit together.
export async function recordVehicleNameplate(client,task,actor,fileId,requestId) {
 const {rows:previous}=await client.query("select id from files where order_id=$1 and kind='vehicle_nameplate_photo' and id<>$2 order by created_at desc,id desc limit 1",[task.orderId,fileId]);
 const previousFileId=task.vehicleNameplateFileId||previous[0]?.id;
 await client.query("update dispatch_tasks set data=jsonb_set(data,'{vehicleNameplateFileId}',to_jsonb($2::text)) where order_id=$1",[task.orderId,fileId]);
 const {rows:[event]}=await client.query('insert into dispatch_events(order_id,actor_id,actor_name,request_id,request_body,action,detail) values($1,$2,$3,$4,$5,$6,$7) returning id',[
  task.orderId,actor.id,actor.name,`nameplate:${requestId}`,JSON.stringify({fileId}), 'vehicle-nameplate-upload',JSON.stringify({fileId,previousFileId})
 ]);
 if(!previousFileId)return;
 const {rows:people}=await client.query('select id,role,roles from users where active=true and shop_id=$1',[task.shopId]);
 for(const person of people.filter(person=>hasRole(person,'warehouse'))) {
  await client.query('insert into dispatch_notifications(id,order_id,event_id,recipient_id,kind,payload) values($1,$2,$3,$4,$5,$6) on conflict(event_id,recipient_id,kind) do nothing',[
   randomUUID(),task.orderId,event.id,person.id,'车辆铭牌已更新',JSON.stringify({orderId:task.orderId,shopId:task.shopId,plate:task.plate,dispatchNo:task.dispatchNo,actorName:actor.name,fileId,summary:'车辆铭牌照片已重新上传，请按最新铭牌核对车型、发动机型号和 VIN。'})
  ]);
 }
}
export async function validateNameplateNotification(row,user,client) {
 if(!user?.active||user.id!==row.recipient_id||user.shopId!==row.payload.shopId||!hasRole(user,'warehouse'))return false;
 const {rows}=await client.query("select 1 from dispatch_tasks dt join work_orders wo on wo.id=dt.order_id where dt.order_id=$1 and wo.shop_id=$2 and dt.data->>'vehicleNameplateFileId'=$3",[row.order_id,user.shopId,row.payload.fileId]);
 return rows.length>0;
}
