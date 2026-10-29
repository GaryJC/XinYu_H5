// Preview by default. Apply only a previously reviewed, explicit ID list.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pool } from '../server/database/pool.mjs';
import { executeSqlServerQuery, executeSqlServerTransaction, closeSqlServerPool } from '../server/database/sqlServerPool.mjs';
import { readHistoryCandidates, readHistoryHeaders, historyReport, completeHistoricalOrders } from '../server/repositories/legacyHistoryCompletionRepository.mjs';

const args=process.argv.slice(2);
const option=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
try {
  const {rows:[{cutoff}]} = await pool.query("select min(at) as cutoff from dispatch_events where action='assign'");
  if (!cutoff) throw new Error('没有可核实的派工启用记录');
  if (!args.includes('--apply')) {
    const orders=await readHistoryCandidates(pool);
    const headers=await readHistoryHeaders(executeSqlServerQuery,orders);
    console.log(JSON.stringify({cutoff,report:historyReport(orders,headers,cutoff)},null,2));
  } else {
    if (!option('--ids-file') || !option('--backup-dir')) throw new Error('必须指定 --ids-file 和 --backup-dir');
    const ids=JSON.parse(await fs.readFile(option('--ids-file'),'utf8'));
    if (!Array.isArray(ids)||!ids.length||ids.length>1000||ids.some(id=>typeof id!=='string'||!id.startsWith('WT-'))||new Set(ids).size!==ids.length) throw new Error('单号清单无效');
    const client=await pool.connect();
    const batchId=randomUUID();
    try {
      await client.query('begin');
      await client.query("set local lock_timeout='5s'");
      const orders=await readHistoryCandidates(client,ids,true);
      if(orders.length!==ids.length) throw new Error('单号数量不匹配');
      await executeSqlServerTransaction(async execute=>{
        const headers=await readHistoryHeaders(execute,orders);
        const report=historyReport(orders,headers,cutoff);
        if(report.some(r=>r.reason)) throw new Error('复核不通过：'+JSON.stringify(report.filter(r=>r.reason)));
        const items=(await client.query('select * from repair_items where order_id=any($1::text[]) order by order_id,id for update',[ids])).rows;
        await fs.mkdir(option('--backup-dir'),{recursive:true});
        const backup=path.resolve(option('--backup-dir'),`history-completion-${batchId}.json`);
        await fs.writeFile(backup,JSON.stringify({batchId,cutoff,at:new Date(),orders,items,headers},null,2),{flag:'wx',mode:0o600});
        await completeHistoricalOrders(client,orders,headers,cutoff,batchId);
        await client.query('commit');
        console.log(JSON.stringify({applied:true,batchId,backup,report},null,2));
      });
    } catch(error){await client.query('rollback');throw error;} finally{client.release();}
  }
} finally{await Promise.allSettled([pool.end(),closeSqlServerPool()]);}
