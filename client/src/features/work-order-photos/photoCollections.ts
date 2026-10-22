import type { StoredFile, WorkOrder } from '../../../../shared/types';

/** Keep legacy storage categories intact while presenting one supplementary album. */
export function orderPhotoCollections(order: WorkOrder) {
  const photos = order.inspection.preRepairPhotos || {};
  const hidden = new Set(order.inspection.replacedPhotoIds || []);
  const paperIds = new Set(order.paperOrder?.photoIds || []);
  const standardIds = new Set([photos.front45, photos.rear45, photos.mileage].filter(Boolean));
  const visible = (order.files || []).filter(file => !hidden.has(file.id));
  const filesById = new Map(visible.map(file => [file.id, file]));
  const licenseIds = new Set(visible.filter(file => file.kind === 'vehicle_license').map(file => file.id));
  if (order.inspection.vehicleLicenseFileId) licenseIds.add(order.inspection.vehicleLicenseFileId);
  const supplementaryIds = [...new Set([
    ...(photos.extra || []),
    ...visible.filter(file => ['other', 'damage_photo'].includes(file.kind) && file.mimeType.startsWith('image/')).map(file => file.id)
  ])].filter(id => !hidden.has(id) && !paperIds.has(id) && !standardIds.has(id) && !licenseIds.has(id));
  const describe = (id: string, title: string): Pick<StoredFile, 'id' | 'originalName'> => filesById.get(id) || { id, originalName: title };
  return {
    photos: { ...photos, extra: supplementaryIds },
    supplementaryFiles: supplementaryIds.map((id, index) => describe(id, `补充照片 ${index + 1}`)),
    paperFiles: [...paperIds].filter(id => !hidden.has(id)).map((id, index) => describe(id, `纸质委托书照片 ${index + 1}`)),
    licenseFiles: visible.filter(file => file.kind === 'vehicle_license' && !paperIds.has(file.id))
  };
}

export function supplementaryPhotoSlot(order: WorkOrder, id: string): 'extra' | 'other' {
  const file = order.files?.find(file => file.id === id);
  return file && ['other', 'damage_photo'].includes(file.kind) ? 'other' : 'extra';
}
