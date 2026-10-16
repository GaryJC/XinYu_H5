import { transaction } from "../database/pool.mjs";
import { findWorkOrderById } from "../db.mjs";
import { updateWorkOrderPhoto } from "../repositories/workOrderPhotoRepository.mjs";

export async function saveWorkOrderPhoto(id, input, actor) {
  return transaction(async client => {
    await updateWorkOrderPhoto(client, id, input, actor);
    return findWorkOrderById(client, id);
  });
}
