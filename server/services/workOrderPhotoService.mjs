import { transaction } from "../database/pool.mjs";
import { findWorkOrderById } from "../db.mjs";
import { updateWorkOrderPhoto, removeWorkOrderPhotos } from "../repositories/workOrderPhotoRepository.mjs";

export async function saveWorkOrderPhoto(id, input, actor) {
  return transaction(async client => {
    await updateWorkOrderPhoto(client, id, input, actor);
    return findWorkOrderById(client, id);
  });
}

export async function deleteWorkOrderPhotos(id, input, actor) {
  return transaction(async client => {
    await removeWorkOrderPhotos(client, id, input, actor);
    return findWorkOrderById(client, id);
  });
}
