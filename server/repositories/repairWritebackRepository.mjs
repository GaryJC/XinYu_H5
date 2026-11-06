import { mergePendingWriteback } from '../domain/pendingRepairs.mjs';
import { readPendingRepairs } from './pendingRepairsRepository.mjs';
import {validateLegacyRepairStrings} from './legacyRepairWritebackRepository.mjs';
import {HttpError} from '../http/HttpError.mjs';
import {makeWritebackSnapshot,writebackAllowed,writebackDispatchAllowlist,validateWritebackSnapshot} from '../domain/repairWriteback.mjs';
import {readRepairRounds} from './repairRoundRepository.mjs';
import {repairWritebackSimulationEnabled} from '../domain/repairWritebackSimulation.mjs';
import {readRepairWritebackSimulation,retryRepairWritebackSimulation} from './repairWritebackSimulationRepository.mjs';
export async function enqueueRepairWriteback(client,task,eventId,{deferValidation=false}={}) {
 const rounds=await readRepairRounds(client,task.orderId);
 const roundOnly=task.executionMode!=='outsourced'&&hasEarlierOutsourcedRound(rounds,task.repairRound);
 const {rows:users}=await client.query('select id,legacy_employee_code,legacy_employee_name from users where shop_id=$1',[task.shopId]);
 let snapshot;
 if(roundOnly) {
  const completed=task.items.filter(item=>item.status==='已完工');
  const ids=new Set(completed.map(item=>item.id));
  const {rows:previous}=await client.query(`select distinct (item->>'id')::bigint::text as id from repair_writebacks j
   cross join lateral jsonb_array_elements(j.snapshot->'items') item
   where j.order_id=$1 and j.snapshot->>'operation'='write-round' and j.snapshot->>'repairRound'=$2`,[task.orderId,String(task.repairRound)]);
  const removed=previous.map(row=>Number(row.id)).filter(id=>!ids.has(id));
  if(!completed.length&&!removed.length)return;
  snapshot={...makeWritebackSnapshot(task,completed,users),operation:'write-round'};
  if(!completed.length)snapshot.allowEmptyRemoval=true;
  if(removed.length)snapshot.removedItemIds=removed;
 } else {
  const all=new Map();
  for(const round of rounds) {
   const ids=round.task.technicianIds??(round.task.technicianId?[round.task.technicianId]:[]);
   for(const item of round.task.items)all.set(item.id,{...item,responsibleId:item.responsibleId||(ids.length===1?ids[0]:undefined)});
  }
  for(const item of task.items)all.set(item.id,item);
  const pending=await readPendingRepairs(client,task.orderId);
  snapshot=makeWritebackSnapshot(task,mergePendingWriteback([...all.values()],pending.items),users);
  if(!snapshot.items.length&&pending.items.some(p=>p.source==='inspection'&&p.inspectionState==='cancelled'))snapshot.allowEmptyRemoval=true;
  if(deferValidation)snapshot.operation='replace';
 }
 let validationError='';
 if(task.executionMode!=='outsourced')try{validateWritebackSnapshot(snapshot);
  const {rows:orders}=await client.query('select dispatch_no from work_orders where id=$1',[task.orderId]);
  if(!deferValidation&&writebackAllowed(orders[0]?.dispatch_no))await validateLegacyRepairStrings(snapshot);
 }catch(error){if(!deferValidation)throw new HttpError(409,`润丰写回校验未通过：${error.message}`);validationError=String(error.message);}
 await client.query('insert into repair_writebacks(event_id,order_id,snapshot,status,error) values($1,$2,$3,$4,$5) on conflict(event_id) do nothing',[eventId,task.orderId,JSON.stringify(snapshot),task.executionMode==='outsourced'?'manual':validationError?'failed':'pending',task.executionMode==='outsourced'?'外包任务需人工在润丰登记维修项目及维修人':validationError]);
}
function hasEarlierOutsourcedRound(rounds,currentRound) {
 return rounds.some(round=>round.round<currentRound&&round.task.executionMode==='outsourced');
}
// Keep the last published positions: removing a row must never publish active work
// or renumber the remaining legacy rows. FIFO execution orders this after its baseline.
export async function enqueueRepairRemoval(client,task,eventId,entry) {
 // A reviewed item may already have a mapped row from its first inspection.
 if(task.repairRound&&hasEarlierOutsourcedRound(await readRepairRounds(client,task.orderId),task.repairRound)) {
  await enqueueRoundWithdrawals(client,task,eventId,[entry.itemId],entry.sourceRound??task.repairRound);
  return;
 }
 const {rows}=await client.query('select snapshot from repair_writebacks where order_id=$1 order by id desc limit 1',[task.orderId]);
 const baseline=rows[0]?.snapshot||await readInitialRemovalBaseline(client,task.orderId);
 // A complete prior replacement proves this ID was never published. Avoid a
 // name-only delete that could hit another project with the same name.
 if(baseline&&!baseline.baselineIncomplete&&!baseline.items.some(item=>item.id===entry.itemId))return;
 const snapshot=makeRemovalSnapshot(task,baseline,entry);
 validateWritebackSnapshot(snapshot);
 await client.query('insert into repair_writebacks(event_id,order_id,snapshot,status,error) values($1,$2,$3,$4,$5) on conflict(event_id) do nothing',[eventId,task.orderId,JSON.stringify(snapshot),task.executionMode==='outsourced'?'manual':'pending',task.executionMode==='outsourced'?'外包任务需人工在润丰移除对应维修项目':'']);
}
// A deferred item may have been published before this inspection was reopened.
export async function enqueueRoundWithdrawals(client,task,eventId,itemIds,round=task.repairRound) {
 if(!round)return;
 const snapshot={orderId:task.orderId,plate:task.plate,repairRound:round,operation:'write-round',
  items:[],allowEmptyRemoval:true,removedItemIds:itemIds,partial:true};
 await client.query(`insert into repair_writebacks(event_id,order_id,snapshot,status,error)
  select $1,$2,$3,'pending','' where exists(select 1 from repair_writebacks j
   where j.order_id=$2 and j.snapshot->>'operation'='write-round' and j.snapshot->>'repairRound'=$4
    and exists(select 1 from jsonb_array_elements(j.snapshot->'items') i where i->>'id'=any($5::text[])))
  on conflict(event_id) do nothing`,[eventId,task.orderId,JSON.stringify(snapshot),String(round),itemIds.map(String)]);
}
async function readInitialRemovalBaseline(client,orderId) {
 // The creation payload records IDs and names before any inspection. Its
 // order is not assumed to equal legacy Xh: name-only removal must be unique.
 const {rows}=await client.query("select payload->'order'->'repairItems' as items from legacy_sync_outbox where order_id=$1 and event_type='created' order by revision asc limit 1",[orderId]);
 return Array.isArray(rows[0]?.items)?{items:rows[0].items.map(item=>({...item,legacyPosition:null}))}:undefined;
}
function makeRemovalSnapshot(task,baseline,entry) {
 const previous=(baseline?.items||[]).map((item,index)=>({...item,legacyPosition:item.legacyPosition===undefined?index+1:item.legacyPosition}));
 const target=previous.find(item=>item.id===entry.itemId);
 return {orderId:task.orderId,repairRound:task.repairRound||0,plate:task.plate,operation:'remove',
  ...(!baseline||baseline.baselineIncomplete?{baselineIncomplete:true}:{}),
  removeItem:{id:entry.itemId,name:target?.name||`【待定】${entry.name.replace(/^(?:【待定】)+/u,'')}`,legacyPosition:target?.legacyPosition??null},
  items:previous.filter(item=>item.id!==entry.itemId),allowEmptyRemoval:true};
}
export async function readRepairWriteback(client,id) {
 if(repairWritebackSimulationEnabled()){const simulated=await readRepairWritebackSimulation(client,id);if(simulated)return simulated;}
 const {rows}=await client.query(`select j.id::text,case when j.status='round_pending' then 'pending' else j.status end as status,coalesce((j.snapshot->>'repairRound')::integer,0) as "repairRound",j.error,j.attempts,j.created_at as "createdAt",j.synced_at as "syncedAt",w.dispatch_no from repair_writebacks j join work_orders w on w.id=j.order_id where j.order_id=$1 order by (j.status in ('pending','round_pending','failed')) desc,case when j.status in ('pending','round_pending','failed') then j.id end asc,j.id desc limit 1`,[id]);
 if(!rows[0])return undefined;
 const {dispatch_no,...job}=rows[0];return {...job,enabled:writebackAllowed(dispatch_no)};
}

export async function processRepairWritebacks(runTransaction,write,shouldContinue=()=>true) {
 for(let count=0;count<100&&shouldContinue();count++) {
  const result=await runTransaction(async client=>{
   // Row locks survive until after the SQL Server commit. A receipt on SQL Server handles PG commit loss.
   const {rows}=await client.query(`select j.* from repair_writebacks j join work_orders w on w.id=j.order_id where j.status in ('pending','round_pending') and j.next_attempt_at<=now() and ($1::text[] is null or w.dispatch_no=any($1::text[]))
     and not exists(select 1 from repair_writebacks older where older.order_id=j.order_id and older.id<j.id and older.status not in ('synced','manual'))
     order by j.id for update of w,j skip locked limit 1`,[writebackDispatchAllowlist()]);
   if(!rows[0])return false;
   const job=rows[0];
   // A still-queued pre-upgrade replacement may already have a SQL receipt.
   // Keep its payload immutable and prevent it from replacing outsourced work.
   const replaces=job.snapshot.operation!=='write-round';
   // Claiming the parent with the job serializes this check with a change of mode.
   const {rows:orders}=await client.query(`select dispatch_no,department_code,legacy_reid,legacy_document_no,vehicle_plate,
    ($2::boolean and has_outsourced_repair($1)) as protects_outsourced
    from work_orders where id=$1`,[job.order_id,replaces]);
   try {
    const order=orders[0];
    if(!order?.dispatch_no||!order.legacy_document_no){await client.query("update repair_writebacks set error='等待润丰开单回填派工号及内部编号',next_attempt_at=now()+interval '1 minute' where id=$1",[job.id]);return true;}
    if(order.protects_outsourced)throw new Error('旧版写回任务涉及历史外包项目，请管理员在润丰核对并人工登记本轮项目');
    if(order.vehicle_plate!==job.snapshot.plate)throw new Error('工单车牌已变化，请管理员核对');
    await write({...job.snapshot,eventId:String(job.event_id),dispatchNo:order.dispatch_no,departmentCode:order.department_code,legacyReid:Number(order.legacy_reid),documentNo:Number(order.legacy_document_no)},{
     readRoundHistory:async({latestOnly=false}={})=>{
      const fields=latestOnly?'event_id::text':'event_id::text,status,snapshot';
      const order=latestOnly?'desc limit 1':'asc';
      const {rows}=await client.query(`select ${fields} from repair_writebacks where order_id=$1 and id<$2
       and status in ('synced','manual') and snapshot->>'operation'='write-round' order by id ${order}`,[job.order_id,job.id]);
      return rows;
     }
    });
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
 if(repairWritebackSimulationEnabled())return retryRepairWritebackSimulation(client,id,actorName,
  job=>repairInvalidWritebackSnapshot(client,id,job,{checkLegacyStrings:false}));
 const {rows}=await client.query(`select id,status,snapshot,event_id from repair_writebacks where order_id=$1
  order by (status not in ('synced','manual')) desc,case when status not in ('synced','manual') then id end asc,id desc limit 1 for update`,[id]);
 if(!rows[0]||!['failed','synced'].includes(rows[0].status))throw new HttpError(409,'仅失败或已完成的同步任务可以重试');
 const job=rows[0];
 if(job.status==='failed') {
  const snapshot=await repairInvalidWritebackSnapshot(client,id,job);
  if(snapshot) {
   await client.query('update repair_writebacks set snapshot=$2 where id=$1',[job.id,JSON.stringify(snapshot)]);
   await client.query('insert into audit_logs(order_id,actor,action) values($1,$2,$3)',[id,actorName,`恢复无效润丰写回快照 ${job.id}`]);
  }
 }
 await client.query("update repair_writebacks set status='pending',error='',attempts=0,next_attempt_at=now() where id=$1",[rows[0].id]);
 await client.query("insert into audit_logs(order_id,actor,action) values($1,$2,'重试润丰检验写回')",[id,actorName]);
}

async function repairInvalidWritebackSnapshot(client,id,job,{checkLegacyStrings=true}={}) {
 // Only structurally invalid snapshots are safe to repair in place: the writer
 // validates them before opening SQL Server or recording an idempotency receipt.
 // Valid (including synced) snapshots must remain byte-for-byte stable on retry.
 let invalid=false;
 try {validateWritebackSnapshot(job.snapshot);} catch {invalid=true;}
 if(invalid) {
  const {rows:events}=await client.query('select action,detail from dispatch_events where id=$1 and order_id=$2',[job.event_id,id]);
  let snapshot;
  if(events[0]?.action==='inspection-deferred-cancel'&&!['replace','write-round'].includes(job.snapshot.operation)) {
   const {rows:previous}=await client.query('select snapshot from repair_writebacks where order_id=$1 and id<$2 order by id desc limit 1',[id,job.id]);
   const itemId=events[0].detail?.itemId;
   const target=events[0].detail?.previousItems?.find(item=>item.id===itemId);
   const baselineTarget=previous[0]?.snapshot?.items?.find(item=>item.id===itemId);
   if(!target&&!baselineTarget)throw new HttpError(409,'无法恢复撤销项目，请核对原始项目记录');
   snapshot=makeRemovalSnapshot(job.snapshot,previous[0]?.snapshot||await readInitialRemovalBaseline(client,id),{itemId,name:target?.name||baselineTarget.name});
  } else {
   if(!Array.isArray(job.snapshot?.items))throw new HttpError(409,'维修项目快照不完整，请人工核对');
   snapshot=job.snapshot;
   if(!['write-round','remove'].includes(snapshot.operation)&&snapshot.repairRound>0&&
      hasEarlierOutsourcedRound(await readRepairRounds(client,id),snapshot.repairRound)) {
    const detail=events[0]?.detail;
    if(detail?.repairRound!==snapshot.repairRound||!Array.isArray(detail.items))throw new HttpError(409,'缺少本轮检验记录，请人工核对');
    const published=new Map(snapshot.items.map(item=>[item.id,item]));
    const completed=detail.items.filter(item=>item.status==='已完工').map(item=>{
     const original=published.get(item.id);
     if(!original||original.pendingConfirmation||original.name!==item.name)throw new HttpError(409,'本轮检验记录与写回项目不一致，请人工核对');
     return original;
    });
    snapshot={...snapshot,operation:'write-round',items:completed,...(!completed.length?{allowEmptyRemoval:true}:{})};
   }
   const {rows:users}=await client.query('select u.id,u.legacy_employee_code,u.legacy_employee_name from users u join work_orders w on w.shop_id=u.shop_id where w.id=$1',[id]);
   snapshot={...snapshot,items:snapshot.items.map(item=>{
    if(item.pendingConfirmation||item.employeeCode?.trim()&&item.employeeName?.trim())return item;
    const person=users.find(user=>user.id===item.responsibleId);
    return {...item,employeeCode:person?.legacy_employee_code||null,employeeName:person?.legacy_employee_name||null};
   })};
  }
  try {
   validateWritebackSnapshot(snapshot);
   if(checkLegacyStrings) {
    const {rows:orders}=await client.query('select dispatch_no from work_orders where id=$1',[id]);
    if(snapshot.operation!=='remove'&&writebackAllowed(orders[0]?.dispatch_no))await validateLegacyRepairStrings(snapshot);
   }
  } catch(error) {throw new HttpError(409,`润丰写回校验未通过：${error.message}`);}
  return snapshot;
 }
}

export async function resolveFailedRepairWriteback(client,orderId,actor,input) {
 if(repairWritebackSimulationEnabled())throw new HttpError(409,'模拟任务不能确认为润丰人工登记，请使用模拟重试');
 if(!input||typeof input.jobId!=='string'||!/^\d{1,19}$/.test(input.jobId)||BigInt(input.jobId)>9223372036854775807n||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>2000)throw new HttpError(400,'请选择失败任务并填写人工登记说明');
 const {rows}=await client.query('select id,status from repair_writebacks where order_id=$1 and id=$2 for update',[orderId,input.jobId]);
 if(rows[0]?.status!=='failed')throw new HttpError(409,'该写回任务已变化，仅失败任务可确认人工登记');
 await client.query("update repair_writebacks set status='manual',error=$2 where id=$1",[input.jobId,`管理员 ${actor.name} 确认人工登记：${input.reason.trim()}`]);
 await client.query('insert into audit_logs(order_id,actor,action) values($1,$2,$3)',[orderId,actor.name,`润丰写回任务 ${input.jobId} 确认人工登记：${input.reason.trim()}`]);
}
