import { pool } from '../database/pool.mjs';

// Fixed identifiers only. No payloads, tokens, customer data or recipient IDs.
const queues=['legacy_sync_outbox','repair_writebacks','dispatch_notifications','procurement_notifications'];
export function startRuntimeMetrics({database=pool,intervalMs=60000,log=console.info}={}) {
  let running, stopped=false;
  const tick=()=>{
    if(stopped||running)return;
    running=(async()=>{
      const backlog={};
      for(const table of queues) {
        if(stopped)break;
        const {rows}=await database.query(`select status,count(*)::integer as count,
          coalesce(max(extract(epoch from (now()-created_at))),0)::integer as oldest_seconds
          from ${table} where status in ('pending','round_pending','processing','accepted','failed','unknown') group by status`);
        backlog[table]=rows;
      }
      if(!stopped)log('[runtime-metrics]',JSON.stringify({pool:{total:database.totalCount,idle:database.idleCount,waiting:database.waitingCount},queues:backlog}));
    })().catch(error=>console.error('[runtime-metrics-error]',{code:error.code})).finally(()=>{running=undefined;});
  };
  const timer=setInterval(tick,intervalMs);timer.unref();
  return async()=>{stopped=true;clearInterval(timer);await running;};
}
