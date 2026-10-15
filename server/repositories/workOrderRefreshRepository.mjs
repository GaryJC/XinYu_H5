import { HttpError } from "../http/HttpError.mjs";

export async function lockRefreshOrder(client, id, actor) {
  const { rows } = await client.query("select * from work_orders where id=$1 for update", [id]);
  const order = rows[0];
  if (!order) throw new HttpError(404, "委托单不存在");
  if (!actor.active || !["advisor","manager"].includes(actor.role) || !actor.shopId || actor.shopId !== order.shop_id
      || (actor.role === "advisor" && actor.name !== order.advisor)) throw new HttpError(403, "无权更新该委托单");
  if (["草稿","待客户签字"].includes(order.status)) throw new HttpError(409, "客户签字完成后才能从润丰更新");
  if (order.legacy_sync_status !== "synced") throw new HttpError(409, "请等待润丰推送成功后再更新，避免双向同步冲突");
  const pending = await client.query("select 1 from legacy_sync_outbox where order_id=$1 and status <> 'synced' limit 1", [id]);
  if (pending.rows.length) throw new HttpError(409, "存在未完成的润丰推送，请先处理同步任务");
  return order;
}
export async function readRefreshItems(client, id) {
  const items = await client.query("select * from repair_items where order_id=$1 order by item_no,id", [id]);
  const execution = await client.query(`select exists(select 1 from dispatch_tasks where order_id=$1 and stage <> '待派工')
    or exists(select 1 from repair_items where order_id=$1 and status <> '待派工')
    or exists(select 1 from outbound_orders where order_id=$1) as active`, [id]);
  return { items: items.rows, hasExecution: execution.rows[0]?.active };
}
export async function applyLegacyRefresh(client, order, change, header, actor) {
  const fields = Object.entries(change.fields);
  const params = [order.id, ...fields.map(([,value]) => value), Number(header.reid), Number(header.dh)];
  // Keys originate exclusively from the domain allowlist, never HTTP input.
  await client.query(`update work_orders set ${fields.map(([key],i) => `${key}=$${i+2}`).join(',')},
    legacy_reid=$${params.length-1},legacy_document_no=$${params.length},updated_at=now() where id=$1`, params);
  for (const item of change.removed) await client.query("delete from repair_items where order_id=$1 and id=$2", [order.id,item.id]);
  for (const item of change.items) {
    await client.query(`insert into repair_items(order_id,client_item_id,item_no,name,labor_fee,legacy_item_reid)
      values($1,$2,$3,$4,$5,$6) on conflict(order_id,client_item_id) do update set
      item_no=excluded.item_no,name=excluded.name,labor_fee=excluded.labor_fee,legacy_item_reid=excluded.legacy_item_reid`,
      [order.id,item.clientId,item.itemNo,item.name,item.laborFee,item.sourceId]);
  }
  // Dispatch keeps execution state in JSON; update names there too and invalidate stale action versions.
  await client.query(`update dispatch_tasks dt set data=jsonb_set(dt.data,'{items}',
    coalesce((select jsonb_agg(coalesce(previous.entry,'{}'::jsonb) ||
        jsonb_build_object('id',ri.client_item_id,'name',ri.name,'status',ri.status) order by ri.item_no)
      from repair_items ri left join lateral (
        select entry from jsonb_array_elements(coalesce(dt.data->'items','[]'::jsonb)) entry
        where (entry->>'id')::bigint=ri.client_item_id limit 1
      ) previous on true where ri.order_id=$1),'[]'::jsonb)),
    version=version+1,updated_at=now() where order_id=$1`, [order.id]);
  await client.query("insert into audit_logs(order_id,actor,action) values($1,$2,$3)",
    [order.id,actor.name,`从润丰更新归档内容（派工号 ${change.fields.dispatch_no}，维修项目 ${change.items.length} 项）`]);
}
