import { useState } from 'react';
import { Alert, Button, Modal } from 'antd';
import type { VehicleTripDetail } from '../../../../shared/types';
import { AuthenticatedImage } from '../../shared/ui/AuthenticatedImage';
import { TripCameraInput } from './TripCameraInput';

export function ProxyReturnDialog({ trip, busy, pending, error, onCancel, onSubmit, onUpload }: {
  trip: VehicleTripDetail; busy: boolean; pending: string; error: string;
  onCancel: () => void; onSubmit: (fileIds: string[]) => void; onUpload: (file: File) => void;
}) {
  // Unconfirmed attachments in the detail response belong to the current employee.
  const drafts = trip.attachments.filter(a => a.stage === 'return' && !a.confirmed && a.returnRound === trip.returnRound);
  const [excluded, setExcluded] = useState(() => drafts.slice(9).map(photo => photo.fileId));
  const fileIds = drafts.map(a => a.fileId).filter(id => !excluded.includes(id));
  return <Modal className="trip-proxy-modal" open centered title="代登记还车"
    okText="确认已交车" cancelText="取消" confirmLoading={pending === 'proxy-return'} okButtonProps={{ disabled: busy }}
    cancelButtonProps={{ disabled: busy }} onCancel={() => { if (!busy) onCancel(); }} onOk={() => onSubmit(fileIds)}>
    <dl className="trip-info-grid"><div><dt>车牌</dt><dd>{trip.vehicle.plate}</dd></div>
      <div><dt>原用车人</dt><dd>{trip.applicantName}</dd></div></dl>
    <p>请确认车辆已交回。提交后将释放车辆，并为原用车人记一次漏登记。</p>
    <details className="trip-proxy-capture">
      <summary>公里数照片（选填）{fileIds.length > 0 && ` · 已选 ${fileIds.length} 张`}</summary>
      <TripCameraInput label="拍摄代登记还车公里数照片" busy={pending === 'upload'} disabled={busy || fileIds.length >= 9} onCapture={onUpload} />
      {!!drafts.length && <div className="trip-photos trip-application-photos">{drafts.map(photo => {
        const used = !excluded.includes(photo.fileId);
        return <div key={photo.fileId}><AuthenticatedImage fileId={photo.fileId} alt="代登记还车公里数照片" width={140} height={100} />
          <Button size="small" disabled={busy || (!used && fileIds.length >= 9)} onClick={() => setExcluded(current => used
            ? [...current, photo.fileId] : current.filter(id => id !== photo.fileId))}>{used ? '不使用此照片' : '重新选用'}</Button>
        </div>;
      })}</div>}
    </details>
    {error && <Alert type="error" showIcon title={error} />}
  </Modal>;
}
