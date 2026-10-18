import { transaction } from "../database/pool.mjs";
import { findWorkOrderById } from "../db.mjs";
import { customerVehicleEditEnabled } from "../config/customerVehicleEdit.mjs";
import { HttpError } from "../http/HttpError.mjs";
import { parseCustomerVehicleUpdate, customerVehicleValues, assertReferenceMatches } from "../domain/customerVehicleUpdate.mjs";
import { lockCustomerVehicleOrder, applyCustomerVehicleUpdate } from "../repositories/customerVehicleUpdateRepository.mjs";
import { findLegacyReferenceByCode } from "../repositories/legacyVehicleRepository.mjs";
import { enqueueLegacySyncEvent } from "../repositories/legacySyncOutboxRepository.mjs";

export async function updateCustomerVehicle(id, input, actor, dependencies = {}) {
  const { enabled = customerVehicleEditEnabled(), runTransaction = transaction,
    readReference = findLegacyReferenceByCode, readResult = findWorkOrderById } = dependencies;
  if (!enabled) throw new HttpError(409, "润丰更新功能尚未启用，请联系管理员完成对接");
  const change = parseCustomerVehicleUpdate(input);
  return runTransaction(async client => {
    const order = await lockCustomerVehicleOrder(client, id, actor, change.expectedRevision);
    const before = customerVehicleValues(order);
    if (Object.entries(before).every(([key, value]) => value === change[key])) return readResult(client, id);
    // Read real Runfeng references; never fall back to mock master data here.
    const [model, organization] = await Promise.all([
      readReference("model", change.modelLegacyCode), readReference("organization", change.organizationLegacyCode)
    ]);
    assertReferenceMatches(model, change.model, "车型");
    assertReferenceMatches(organization, change.organization, "所属单位");
    await applyCustomerVehicleUpdate(client, order, change, actor);
    await enqueueLegacySyncEvent(client, await readResult(client, id), "updated");
    return readResult(client, id);
  });
}
