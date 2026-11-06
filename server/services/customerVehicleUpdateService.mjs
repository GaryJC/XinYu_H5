import { transaction } from "../database/pool.mjs";
import { findWorkOrderById } from "../db.mjs";
import { customerVehicleEditEnabled } from "../config/customerVehicleEdit.mjs";
import { HttpError } from "../http/HttpError.mjs";
import { parseCustomerVehicleUpdate, customerVehicleValues } from "../domain/customerVehicleUpdate.mjs";
import { lockCustomerVehicleOrder, applyCustomerVehicleUpdate } from "../repositories/customerVehicleUpdateRepository.mjs";
import { enqueueLegacySyncEvent } from "../repositories/legacySyncOutboxRepository.mjs";

export async function updateCustomerVehicle(id, input, actor, dependencies = {}) {
  const { enabled = customerVehicleEditEnabled(), runTransaction = transaction,
    readResult = findWorkOrderById } = dependencies;
  if (!enabled) throw new HttpError(409, "润丰更新功能尚未启用，请联系管理员完成对接");
  const change = parseCustomerVehicleUpdate(input);
  return runTransaction(async client => {
    const order = await lockCustomerVehicleOrder(client, id, actor, change.expectedRevision);
    const before = customerVehicleValues(order);
    if (Object.entries(before).every(([key, value]) => value === change[key])) return readResult(client, id);
    await applyCustomerVehicleUpdate(client, order, change, actor);
    await enqueueLegacySyncEvent(client, await readResult(client, id), "updated");
    return readResult(client, id);
  });
}
