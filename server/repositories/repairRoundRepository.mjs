import { HttpError } from '../http/HttpError.mjs';
export async function readRepairRounds(client,orderId) {
  const {rows}=await client.query('select * from dispatch_repair_rounds where order_id=$1 order by round_no',[orderId]);
  return rows.map(r=>({round:r.round_no,task:r.snapshot,reason:r.reason,openedBy:r.opened_by||undefined,openedName:r.opened_name,openedAt:r.opened_at?.toISOString(),completedAt:r.completed_at?.toISOString(),closed:r.closed}));
}
export async function repairCatalog(client,task) {
  const rounds=await readRepairRounds(client,task.orderId);
  const items=new Map();
  for(const round of rounds) for(const item of round.task.items) items.set(item.id,{id:item.id,name:item.name});
  for(const item of task.items) items.set(item.id,{id:item.id,name:item.name});
  return [...items.values()];
}
export async function saveRepairRound(client,previous,next,actor,action) {
  const snapshot=task=>{const {repairCatalog,...data}=task;return JSON.stringify(data);};
  if(action==='reopen-repair') {
    // Record the legacy/original repair once; never invent an unknown completion date.
    if(!previous.repairRound) await client.query(`insert into dispatch_repair_rounds(order_id,round_no,snapshot,closed,completed_at)
      values($1,0,$2,true,$3) on conflict do nothing`,[previous.orderId,snapshot(previous),previous.completedAt||null]);
    await client.query(`insert into dispatch_repair_rounds(order_id,round_no,snapshot,opened_by,opened_name,reason,opened_at)
      values($1,$2,$3,$4,$5,$6,$7)`,[next.orderId,next.repairRound,snapshot(next),actor.id,actor.name,next.roundReason,next.roundOpenedAt]);
  } else if(next.repairRound) {
    await client.query(`update dispatch_repair_rounds set snapshot=$3,closed=$4,completed_at=$5 where order_id=$1 and round_no=$2 and not closed`,[next.orderId,next.repairRound,snapshot(next),next.stage==='维修完成',next.completedAt||null]);
  }
}
export async function assertNoActiveRepair(client,id) {
  const {rows}=await client.query("select 1 from dispatch_tasks where order_id=$1 and (data->>'repairRound')::integer>0 and stage<>'维修完成'",[id]);
  if(rows.length) throw new HttpError(409,'返工维修尚未完成，请先完成检验再完结或结算');
}
