import { transaction } from "../database/pool.mjs";
import { findWorkOrderById } from "../db.mjs";
import { readLegacyWorkOrder } from "../repositories/legacyWorkOrderRepository.mjs";
import { lockRefreshOrder, readRefreshItems, applyLegacyRefresh } from "../repositories/workOrderRefreshRepository.mjs";
import { buildLegacyRefresh } from "../domain/legacyRefresh.mjs";

export async function refreshWorkOrderFromLegacy(id, actor, dependencies = {}) {
  const { runTransaction = transaction, readSource = readLegacyWorkOrder, readResult = findWorkOrderById } = dependencies;
  return runTransaction(async client => {
    const order = await lockRefreshOrder(client, id, actor);
    const snapshot = await readSource(order);
    const { items, hasExecution } = await readRefreshItems(client, id);
    const change = buildLegacyRefresh(snapshot, items, hasExecution);
    await applyLegacyRefresh(client, order, change, snapshot.header, actor);
    return readResult(client, id);
  });
}
