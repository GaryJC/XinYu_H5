import {validateWritebackSnapshot} from '../domain/repairWriteback.mjs';
import {repairWritebackSimulationEnabled} from '../domain/repairWritebackSimulation.mjs';
import {HttpError} from '../http/HttpError.mjs';

export async function processRepairWritebackSimulations(runTransaction,shouldContinue=()=>true,env=process.env) {
 if(!repairWritebackSimulationEnabled(env))throw new Error('模拟写回未启用');
 for(let count=0;count<100&&shouldContinue();count++) {
  const processed=await runTransaction(async client=>{
   const {rows}=await client.query(`select j.*,coalesce(s.attempts,0) as mock_attempts from repair_writebacks j
    left join repair_writeback_simulations s on s.job_id=j.id
    where j.status in ('pending','failed') and (s.status is null or s.status='pending')
    and not exists(select 1 from repair_writebacks older left join repair_writeback_simulations os on os.job_id=older.id
     where older.order_id=j.order_id and older.id<j.id and older.status not in ('synced','manual') and coalesce(os.status,'pending')<>'synced')
    order by j.id for update of j skip locked limit 1`);
   const job=rows[0];if(!job)return false;
   let error='';
   try {
    validateWritebackSnapshot(job.snapshot);
    if(env.RUNFENG_REPAIR_WRITEBACK_MOCK_RESULT==='failure')throw new Error('模拟写回失败（测试注入），可切换成功模式后重试');
   } catch(e) {error=String(e.message||e).slice(0,2000);}
   await client.query(`insert into repair_writeback_simulations(job_id,status,attempts,error,snapshot,synced_at)
    values($1,$2,$3,$4,$5,case when $2='synced' then now() else null end)
    on conflict(job_id) do update set status=excluded.status,attempts=excluded.attempts,error=excluded.error,
     snapshot=excluded.snapshot,synced_at=excluded.synced_at,updated_at=now()`,
    [job.id,error?'failed':'synced',job.mock_attempts+1,error,JSON.stringify(job.snapshot)]);
   return true;
  });
  if(!processed)return;
 }
}

export async function readRepairWritebackSimulation(client,id) {
 const {rows}=await client.query(`select j.id::text,coalesce(s.status,j.status) as status,
  coalesce((j.snapshot->>'repairRound')::integer,0) as "repairRound",coalesce(s.error,j.error) as error,
  coalesce(s.attempts,0) as attempts,j.created_at as "createdAt",s.synced_at as "syncedAt"
  from repair_writebacks j left join repair_writeback_simulations s on s.job_id=j.id where j.order_id=$1 and j.status in ('pending','failed')
  order by (coalesce(s.status,j.status) in ('pending','failed')) desc,
   case when coalesce(s.status,j.status) in ('pending','failed') then j.id end asc,j.id desc limit 1`,[id]);
 return rows[0]?{...rows[0],simulated:true,enabled:true}:undefined;
}

export async function retryRepairWritebackSimulation(client,id,actorName) {
 const job=await readRepairWritebackSimulation(client,id);
 if(!job||!['synced','failed'].includes(job.status))throw new HttpError(409,'仅失败或已完成的模拟任务可以重试');
 const locked=await client.query('select status from repair_writebacks where id=$1 for update',[job.id]);
 if(!['pending','failed'].includes(locked.rows[0]?.status))throw new HttpError(409,'此任务已有真实处理结果，不可模拟重试');
 await client.query(`insert into repair_writeback_simulations(job_id,status) values($1,'pending')
  on conflict(job_id) do update set status='pending',error='',synced_at=null,updated_at=now()`,[job.id]);
 await client.query('insert into audit_logs(order_id,actor,action) values($1,$2,$3)',[id,actorName,'重试测试模拟写回（未写入正式润丰）']);
}
