import { randomUUID } from 'node:crypto';
import { validatePendingText,pendingRepairProgress } from '../domain/pendingRepairs.mjs';
import { HttpError } from '../http/HttpError.mjs';
import { readRepairRounds } from './repairRoundRepository.mjs';
export async function readPendingRepairProgress(client,id,items) {
 const {rows}=await client.query('select stage,data from dispatch_tasks where order_id=$1',[id]);
 const task=rows[0]?{...rows[0].data,stage:rows[0].stage}:undefined;
 return pendingRepairProgress(items,task,await readRepairRounds(client,id));
}
export async function readPendingRepairs(client,id,lock=false) {
 const {rows}=await client.query(`select pending_repairs as items,pending_repairs_version as version,shop_id,status,vehicle_plate as plate,dispatch_no as "dispatchNo" from work_orders where id=$1${lock?' for update':''}`,[id]);
 if(!rows[0])throw new HttpError(404,'委托单不存在');
 return rows[0];
}
export async function newPendingRepair(client,input,actor) {
 const name=validatePendingText(typeof input.name==='string'?input.name.replace(/^(?:【待定】)+/,''):input.name,'项目名称');
 const reason=validatePendingText(input.reason,'待确认原因',2000);
 const {rows}=await client.query("select nextval('pending_repair_item_ids') as id");
 return {id:randomUUID(),itemId:Number(rows[0].id),name,reason,...(Number.isSafeInteger(input.draftItemId)?{draftItemId:input.draftItemId}:{}),state:'pending',scheduled:false,history:[{action:'登记待确认',actor:actor.name,at:new Date().toISOString(),note:reason}]};
}
export async function writePendingRepairs(client,id,items) {
 await client.query('update work_orders set pending_repairs=$2,pending_repairs_version=pending_repairs_version+1,updated_at=now() where id=$1',[id,JSON.stringify(items)]);
}
export async function saveDraftPendingRepairs(client,order,actor,expectedVersion) {
 if(order.pendingRepairs===undefined)return;
 const stored=await readPendingRepairs(client,order.id,true);
 if(expectedVersion!==undefined&&stored.version!==expectedVersion)throw new HttpError(409,'待确认项目已更新，请刷新委托单');
 if(!Array.isArray(order.pendingRepairs)||order.pendingRepairs.length>100)throw new HttpError(400,'待确认项目最多 100 项');
 const items=[];
 for(const input of order.pendingRepairs) {
  const known=stored.items.find(p=>p.id===input.id);
  if(known)items.push({...known,name:validatePendingText(typeof input.name==='string'?input.name.replace(/^(?:【待定】)+/,''):input.name,'项目名称'),reason:validatePendingText(input.reason,'待确认原因',2000)});
  else items.push(await newPendingRepair(client,input,actor||{name:order.advisor}));
 }
 await writePendingRepairs(client,order.id,items);
}
export async function listPendingFollowups(client,shopId) {
 const {rows}=await client.query(`select id as "orderId",vehicle_plate as plate,dispatch_no as "dispatchNo",pending_repairs as items,pending_repairs_version as version from work_orders where shop_id=$1 and exists(select 1 from jsonb_array_elements(pending_repairs) p where p->>'state'='pending' or p->>'state'='approved' and p->>'scheduled'='false') order by updated_at desc`,[shopId]);return rows;
}
export async function readPendingRequest(client,id,actorId,requestId) {
 const {rows}=await client.query('select body from pending_repair_requests where order_id=$1 and actor_id=$2 and request_id=$3',[id,actorId,requestId]);return rows[0]?.body;
}
export async function recordPendingRequest(client,id,actor,input) {
 await client.query('insert into pending_repair_requests(order_id,actor_id,request_id,body) values($1,$2,$3,$4)',[id,actor.id,input.requestId,JSON.stringify(input)]);
 await client.query('insert into audit_logs(order_id,actor,action) values($1,$2,$3)',[id,actor.name,`待确认项目：${input.action}`]);
}
