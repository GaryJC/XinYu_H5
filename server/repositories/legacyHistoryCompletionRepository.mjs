import { historyCompletionReason } from '../domain/legacyHistoryCompletion.mjs';

export async function readHistoryCandidates(client, ids, lock = false) {
  if (lock) await client.query('select id from work_orders where id=any($1::text[]) order by id for update', [ids]);
  const {rows} = await client.query(`select w.*,
    (exists(select 1 from work_orders other where other.id<>w.id and other.dispatch_no=w.dispatch_no and w.dispatch_no<>'')
      or exists(select 1 from dispatch_tasks d where d.order_id=w.id)
      or exists(select 1 from repair_items i where i.order_id=w.id and (i.status<>'待派工' or i.start_at<>'' or i.finish_at<>''))
      or exists(select 1 from outbound_orders o where o.order_id=w.id)
      or exists(select 1 from dispatch_repair_rounds r where r.order_id=w.id)
      or jsonb_array_length(w.pending_repairs)>0) as has_activity,
    (exists(select 1 from legacy_sync_outbox l where l.order_id=w.id and l.status<>'synced')
      or exists(select 1 from repair_writebacks r where r.order_id=w.id and r.status<>'synced')) as pending_sync
    from work_orders w where ${ids ? 'w.id=any($1::text[])' : "w.status in ('已委托','待派工')"} order by w.id`, ids ? [ids] : []);
  return rows;
}
export async function readHistoryHeaders(execute, orders) {
  const numbers = [...new Set(orders.map(o => o.dispatch_no).filter(Boolean))];
  if (!numbers.length) return [];
  if (numbers.length > 1000) throw new Error('请分批处理，每批最多 1000 个派工号');
  const {recordset} = await execute(`select reid,dh,RTRIM(wd) as wd,RTRIM(pgd) as pgd,RTRIM(ch) as plate,
    RTRIM(bm) as department,RTRIM(shbz) as approved,RTRIM(del) as deleted,RTRIM(jcrq) as arrival,RTRIM(bzxx) as marker
    from dbo.qxwxb where pgd in (${numbers.map((_,i) => '@p'+i).join(',')})`,
    (request,sql) => numbers.forEach((n,i) => request.input('p'+i,sql.VarChar(50),n)));
  return recordset || [];
}
export function historyReport(orders, headers, cutoff) {
  return orders.map(order => ({id:order.id, dispatchNo:order.dispatch_no,
    reason:historyCompletionReason(order,headers.filter(h=>h.pgd===order.dispatch_no),cutoff)}));
}
export async function completeHistoricalOrders(client, orders, headers, cutoff, batchId) {
  const report = historyReport(orders, headers, cutoff);
  if (report.some(r=>r.reason)) throw new Error('复核未通过：'+JSON.stringify(report.filter(r=>r.reason)));
  // Older deployed releases do not yet have the optional approval display flag.
  // The verified evidence remains in the backup and audit on both schemas.
  const {rows:[{present}]} = await client.query("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_orders' and column_name='legacy_approved') as present");
  for (const order of orders) {
    await client.query(`update work_orders set status='完成',${present?'legacy_approved=true,':''}updated_at=now() where id=$1`, [order.id]);
    await client.query("update repair_items set status='已完工' where order_id=$1", [order.id]);
    await client.query('insert into audit_logs(order_id,actor,action) values($1,$2,$3)', [order.id,'历史数据修正',
      `按润丰内单已审核补齐历史完结状态；派工号 ${order.dispatch_no}；原状态 ${order.status}；批次 ${batchId}；未补造维修时间和检验签名`]);
  }
  return report;
}
