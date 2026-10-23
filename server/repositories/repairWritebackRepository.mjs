import { mergePendingWriteback } from '../domain/pendingRepairs.mjs';
import { readPendingRepairs } from './pendingRepairsRepository.mjs';
import {validateLegacyRepairStrings} from './legacyRepairWritebackRepository.mjs';
import {HttpError} from '../http/HttpError.mjs';
import {makeWritebackSnapshot,writebackAllowed,writebackDispatchAllowlist,validateWritebackSnapshot} from '../domain/repairWriteback.mjs';
import {readRepairRounds} from './repairRoundRepository.mjs';
export async function enqueueRepairWriteback(client,task,eventId) {
 // Replacement must include prior completed rounds, not just the current rework subset.
 const all=new Map();
 for(const round of await readRepairRounds(client,task.orderId))for(const item of round.task.items){const ids=round.task.technicianIds??(round.task.technicianId?[round.task.technicianId]:[]);all.set(item.id,{...item,responsibleId:item.responsibleId||(ids.length===1?ids[0]:undefined)});}
 for(const item of task.items)all.set(item.id,item);
 const {rows:users}=await client.query('select id,legacy_employee_code,legacy_employee_name from users where shop_id=$1',[task.shopId]);
 const pending=await readPendingRepairs(client,task.orderId);
 const snapshot=makeWritebackSnapshot(task,mergePendingWriteback([...all.values()],pending.items),users);
 if(task.executionMode!=='outsourced')try{validateWritebackSnapshot(snapshot);
  const {rows:orders}=await client.query('select dispatch_no from work_orders where id=$1',[task.orderId]);
  if(writebackAllowed(orders[0]?.dispatch_no))await validateLegacyRepairStrings(snapshot);
 }catch(error){throw new HttpError(409,`润丰写回校验未通过：${error.message}`);}
 await client.query('insert into repair_writebacks(event_id,order_id,snapshot,status,error) values($1,$2,$3,$4,$5) on conflict(event_id) do nothing',[eventId,task.orderId,JSON.stringify(snapshot),task.executionMode==='outsourced'?'manual':'pending',task.executionMode==='outsourced'?'外包任务需人工在润丰登记维修项目及维修人':'']);
}
export async function readRepairWriteback(client,id) {
 const {rows}=await client.query(`select j.id::text,j.status,coalesce((j.snapshot->>'repairRound')::integer,0) as "repairRound",j.error,j.attempts,j.created_at as "createdAt",j.synced_at as "syncedAt",w.dispatch_no from repair_writebacks j join work_orders w on w.id=j.order_id where j.order_id=$1 order by (j.status in ('pending','failed')) desc,case when j.status in ('pending','failed') then j.id end asc,j.id desc limit 1`,[id]);
 if(!rows[0])return undefined;
 const {dispatch_no,...job}=rows[0];return {...job,enabled:writebackAllowed(dispatch_no)};
}

export async function processRepairWritebacks(runTransaction,write,shouldContinue=()=>true) {
 for(let count=0;count<100&&shouldContinue();count++) {
  const result=await runTransaction(async client=>{
   // Row locks survive until after the SQL Server commit. A receipt on SQL Server handles PG commit loss.
   const {rows}=await client.query(`select j.* from repair_writebacks j join work_orders w on w.id=j.order_id where j.status='pending' and j.next_attempt_at<=now() and ($1::text[] is null or w.dispatch_no=any($1::text[]))
     and not exists(select 1 from repair_writebacks older where older.order_id=j.order_id and older.id<j.id and older.status not in ('synced','manual'))
     order by j.id for update of j skip locked limit 1`,[writebackDispatchAllowlist()]);
   if(!rows[0])return false;
   const job=rows[0];
   const {rows:orders}=await client.query('select dispatch_no,department_code,legacy_reid,legacy_document_no,vehicle_plate from work_orders where id=$1',[job.order_id]);
   try {
    const order=orders[0];
    if(!order?.dispatch_no||!order.legacy_document_no){await client.query("update repair_writebacks set error='等待润丰开单回填派工号及内部编号',next_attempt_at=now()+interval '1 minute' where id=$1",[job.id]);return true;}
    if(order.vehicle_plate!==job.snapshot.plate)throw new Error('工单车牌已变化，请管理员核对');
    await write({...job.snapshot,eventId:String(job.event_id),dispatchNo:order.dispatch_no,departmentCode:order.department_code,legacyReid:Number(order.legacy_reid),documentNo:Number(order.legacy_document_no)});
    await client.query("update repair_writebacks set status='synced',error='',synced_at=now(),attempts=attempts+1 where id=$1",[job.id]);
   } catch(error) {
    const attempts=job.attempts+1;
    await client.query(`update repair_writebacks set status=$2,error=$3,attempts=$4,next_attempt_at=now()+interval '1 minute' where id=$1`,[job.id,attempts>=5?'failed':'pending',String(error.message||error).slice(0,2000),attempts]);
   }
   return true;
  });
  if(!result)return;
 }
}

export async function retryFailedRepairWriteback(client,id,actorName) {
 const {rows}=await client.query("select id,status from repair_writebacks where order_id=$1 and status<>'manual' order by (status<>'synced') desc,case when status<>'synced' then id end asc,id desc limit 1 for update",[id]);
 if(!rows[0]||!['failed','synced'].includes(rows[0].status))throw new HttpError(409,'仅失败或已完成的同步任务可以重试');
 await client.query("update repair_writebacks set status='pending',error='',attempts=0,next_attempt_at=now() where id=$1",[rows[0].id]);
 await client.query("insert into audit_logs(order_id,actor,action) values($1,$2,'重试润丰检验写回')",[id,actorName]);
}

export async function resolveFailedRepairWriteback(client,orderId,actor,input) {
 if(!input||typeof input.jobId!=='string'||!/^\d{1,19}$/.test(input.jobId)||BigInt(input.jobId)>9223372036854775807n||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>2000)throw new HttpError(400,'请选择失败任务并填写人工登记说明');
 const {rows}=await client.query('select id,status from repair_writebacks where order_id=$1 and id=$2 for update',[orderId,input.jobId]);
 if(rows[0]?.status!=='failed')throw new HttpError(409,'该写回任务已变化，仅失败任务可确认人工登记');
 await client.query("update repair_writebacks set status='manual',error=$2 where id=$1",[input.jobId,`管理员 ${actor.name} 确认人工登记：${input.reason.trim()}`]);
 await client.query('insert into audit_logs(order_id,actor,action) values($1,$2,$3)',[orderId,actor.name,`润丰写回任务 ${input.jobId} 确认人工登记：${input.reason.trim()}`]);
}
