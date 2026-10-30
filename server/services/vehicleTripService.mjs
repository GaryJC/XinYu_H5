import {enqueueTripNotification} from '../repositories/vehicleTripNotificationRepository.mjs';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { hasRole } from '../../shared/roles.mjs';
import { HttpError } from '../http/HttpError.mjs';
import { saveUploadedFile } from '../storage.mjs';
import { VehicleTripRepository } from '../repositories/vehicleTripRepository.mjs';
import { assertTripAccess, assertTripAction, assertTripUpload, requireTripUser, requireVehicleManager, tripText, vehicleInput, tripFileKinds } from '../domain/vehicleTrips.mjs';

export async function prepareTripImage(input, stage) {
  if (typeof input.imageBase64 !== 'string' || input.imageBase64.length > 14 * 1024 * 1024) throw new HttpError(400, '请选择不超过 10 MB 的图片');
  const raw = Buffer.from(input.imageBase64.replace(/^data:[^,]*,/, ''), 'base64');
  if (!raw.length || raw.length > 10 * 1024 * 1024) throw new HttpError(400, '图片为空或过大');
  try {
    const image = sharp(raw, { limitInputPixels: 40_000_000 }).rotate();
    const meta = await image.metadata();
    if (!['jpeg', 'png', 'webp', 'heif'].includes(meta.format) || (meta.pages || 1) > 1 || meta.width < 2 || meta.height < 2) throw new Error('Unsupported image');
    const jpg = await image.resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    return { imageBase64: jpg.toString('base64'), mimeType: 'image/jpeg', fileName: `${stage}.jpg` };
  } catch { throw new HttpError(400, '照片无法读取，请重新拍摄或选择 JPEG、PNG 图片'); }
}

export function createVehicleTripService(repository = new VehicleTripRepository(), saveFile = saveUploadedFile) {
  async function operation(user, input, action, tripId, run) {
    requireTripUser(user);
    const requestId = tripText(input.requestId, '请求编号', 100);
    const fingerprint = createHash('sha256').update(JSON.stringify({ action, tripId, input })).digest('hex');
    return repository.transaction(async repo => {
      const prior = await repo.lockOperation(user.id, requestId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new HttpError(409, '请求编号已用于其他内容，请刷新重试');
        assertTripAccess(await repo.getTrip(prior.trip_id), user);
        return prior.result;
      }
      const result = await run(repo);
      await repo.recordOperation(user, requestId, fingerprint, tripId || result.id, action, result);
      await enqueueTripNotification(repo.database,user,requestId,action,result);
      return result;
    });
  }
  return {
    async vehicles(user, all = false) { requireTripUser(user); return repository.listVehicles(user, all); },
    async saveVehicle(user, input, id) {
      requireVehicleManager(user);
      const normalized = vehicleInput(input);
      try {
        return await repository.transaction(async repo => {
          if (id) {
            const existing = await repo.getVehicle(id, true);
            if (!existing || existing.shopId !== user.shopId) throw new HttpError(404, '车辆不存在');
          }
          return repo.saveVehicle(id || `cv_${randomUUID()}`, user.shopId, normalized, Boolean(id));
        });
      } catch (error) {
        if (error.code === '23505') throw new HttpError(409, '该车牌号已存在，请勿重复录入');
        throw error;
      }
    },
    async list(user, query) { requireTripUser(user); return repository.listTrips(user, query); },
    async detail(user, id) {
      const trip = await repository.getTrip(id);
      assertTripAccess(trip, user);
      return { ...trip, attachments: await repository.attachments(id, user), history: await repository.history(id) };
    },
    async create(user, input) {
      const normalized = { requestId: input.requestId, vehicleId: tripText(input.vehicleId, '车辆', 100), reason: tripText(input.reason, '用车事由'), note: tripText(input.note, '备注', 500, true) };
      return operation(user, normalized, 'create', null, async repo => {
        const car = await repo.getVehicle(normalized.vehicleId, true);
        if (!car || car.shopId !== user.shopId || !car.active) throw new HttpError(409, '车辆不存在或已停用，请重新选择');
        return repo.createTrip(`trip_${randomUUID()}`, user, car, normalized);
      });
    },
    async act(user, id, action, input) {
      return operation(user, input, action, id, async repo => {
        const trip = await repo.getTrip(id, true);
        assertTripAction(trip, user, action);
        if (action === 'depart') {
          const car = await repo.getVehicle(trip.vehicleId, true);
          if (!car?.active) throw new HttpError(409, '车辆已停用，不能出车');
        }
        if (['depart', 'return'].includes(action)) {
          const stage = { depart: 'departure', return: 'return' }[action];
          const ids = input.fileIds;
          if (!Array.isArray(ids) || !ids.length || ids.length > 9 || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new HttpError(400, '请先上传公里数照片（最多 9 张）');
          if (await repo.confirmAttachments(id, stage, user.id, ids) !== ids.length) throw new HttpError(400, '附件不属于本次申请、用途不匹配或不是本人上传');
        }
        const reason = action === 'reject' ? tripText(input.reason, '驳回原因') : '';
        return repo.changeTrip(id, action, user, reason);
      });
    },
    async upload(user, id, input) {
      return operation(user, input, `upload:${input.stage}`, id, async repo => {
        const trip = await repo.getTrip(id, true);
        assertTripUpload(trip, user, input.stage);
        const image = await prepareTripImage(input, input.stage);
        const file = await saveFile({ ...image, kind: tripFileKinds[input.stage], uploadedBy: user.id, database: repo.database });
        await repo.addAttachment(id, input.stage, user, file);
        return { fileId: file.id, stage: input.stage, confirmed: false };
      });
    },
    async authorizeFile(user, fileId) {
      requireTripUser(user);
      const row = await repository.attachmentAccess(fileId);
      if (!row || row.shop_id !== user.shopId || (row.applicant_id !== user.id && !hasRole(user, 'manager')) || (!row.confirmed && row.uploaded_by !== user.id)) throw new HttpError(404, '附件不存在或无权访问');
    }
  };
}
export const vehicleTripService = createVehicleTripService();
