import { hasRole } from '../../../../shared/roles.mjs';
import { Alert } from 'antd';
import type { UserProfile, WorkOrder } from '../../../../shared/types';
import { OrderPhotoGallery } from './OrderPhotoGallery';
import { PreRepairPhotos } from '../pre-repair-photos/PreRepairPhotos';
import { useOrderPhotoUpload } from './useOrderPhotoUpload';
import { orderPhotoCollections, supplementaryPhotoSlot } from './photoCollections';

export function SubmittedOrderPhotos({order, user, onUpdated, section = 'all'}: {
  order: WorkOrder; user?: UserProfile; onUpdated:(order: WorkOrder)=>void; section?:'all'|'license'|'repair'|'other';
}) {
  const upload = useOrderPhotoUpload(order.id, user?.id, onUpdated);
  const canUpload = order.status !== '草稿' && user?.active && user.shopId === order.shop.id
    && (hasRole(user, 'manager') || hasRole(user, 'advisor') && user.name === order.advisor);
  const busy = Boolean(upload.uploading);
  const collections = orderPhotoCollections(order);
  const showStandard = ['all', 'repair'].includes(section);
  const controls = canUpload ? {
    uploading: upload.uploading, error: upload.error, successMessage: upload.successMessage, progress: upload.progress,
    upload: (slot: 'front45'|'rear45'|'mileage'|'extra', file: File) => upload.upload(slot, file, slot !== 'extra' ? order.inspection.preRepairPhotos?.[slot] : undefined),
    uploadExtras: (files: File[]) => upload.uploadMany('extra', files),
    removeExtra: (id: string) => upload.remove([id]),
    removeExtras: (ids: string[]) => upload.remove(ids),
    removePhoto: (id: string) => upload.remove([id]),
    replaceExtra: (id: string, file: File) => upload.upload(supplementaryPhotoSlot(order, id), file, id)
  } : undefined;
  return <>
    {!showStandard && upload.error && <Alert type="error" showIcon title={upload.error} style={{marginTop:12}}/>}
    {!showStandard && upload.successMessage && <Alert type="success" showIcon title={upload.successMessage} style={{marginTop:12}}/>}
    {showStandard && <PreRepairPhotos key={`${order.id}-${user?.id}`} required={!order.paperOrder} photos={collections.photos} disabled={!canUpload} controls={controls}/>}
    {['all','license'].includes(section) && <OrderPhotoGallery key={`${order.id}-${user?.id}-license`} title="行驶证照片" files={collections.licenseFiles} editable={Boolean(canUpload)} busy={busy} multiple={false}
      onUpload={(files, replaceId) => upload.uploadMany('vehicleLicense', files, replaceId)} onRemove={upload.remove}/>}
    {['all','other'].includes(section) && order.paperOrder && <OrderPhotoGallery key={`${order.id}-${user?.id}-paper`} title="纸质委托书照片" files={collections.paperFiles} editable={Boolean(canUpload)} busy={busy} multiple
      canAdd={order.paperOrder.mode === 'pending'} onUpload={(files, replaceId) => upload.uploadMany('other', files, replaceId)} onRemove={upload.remove}/>}
    {section === 'other' && <OrderPhotoGallery key={`${order.id}-${user?.id}-supplementary`} title="补充照片" files={collections.supplementaryFiles} editable={Boolean(canUpload)} busy={busy} multiple
      onUpload={(files, replaceId) => upload.uploadMany(replaceId ? supplementaryPhotoSlot(order, replaceId) : 'extra', files, replaceId)} onRemove={upload.remove}/>}
  </>;
}
