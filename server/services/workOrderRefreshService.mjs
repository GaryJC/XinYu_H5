import { pendingName } from '../domain/pendingRepairs.mjs';
import { transaction } from "../database/pool.mjs";
import { findWorkOrderById } from "../db.mjs";
import { readLegacyWorkOrder } from "../repositories/legacyWorkOrderRepository.mjs";
import { lockRefreshOrder, readRefreshItems, applyLegacyRefresh } from "../repositories/workOrderRefreshRepository.mjs";
import { buildLegacyRefresh } from "../domain/legacyRefresh.mjs";

export async function refreshWorkOrderFromLegacy(id, actor, dependencies = {}) {
  const { runTransaction = transaction, readSource = readLegacyWorkOrder, readResult = findWorkOrderById } = dependencies;
  return runTransaction(async client => {
    const order = await lockRefreshOrder(client, id, actor);
    const source = await readSource(order);
    // Pending rows are tracked separately; importing them as executable repair
    // items would bypass customer confirmation. Match only known pending names.
    const pendingNames=new Set((order.pending_repairs||[]).map(p=>pendingName(p.name)));
    const snapshot={...source,items:source.items.filter(i=>!pendingNames.has(String(i.hh||'').trim()))};
    const { items, hasExecution } = await readRefreshItems(client, id);
    const change = buildLegacyRefresh(snapshot, items, hasExecution);
    await applyLegacyRefresh(client, order, change, snapshot.header, actor);
    return readResult(client, id);
  });
}
