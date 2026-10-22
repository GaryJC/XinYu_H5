import type { ReactNode } from 'react';
import { Checkbox, Spin } from 'antd';
import { AuthenticatedImage } from '../../shared/ui/AuthenticatedImage';
import { PhotoGuide } from './PhotoGuide';
import type { PhotoSlot } from './photoSlots';

export function PreRepairPhotoCard({ label, id, slot, required, busy, uploading, status, error, action, selected, onSelect, imageLabel, selectionLabel }: {
  label: string; id?: string; slot?: PhotoSlot; required?: boolean; busy: boolean; uploading: boolean; status?: string; error?: string;
  imageLabel?: string; selectionLabel?: string; action?: ReactNode; selected?: boolean; onSelect?: (checked: boolean) => void;
}) {
  return <article className={`pre-repair-photo-card${error ? ' has-error' : ''}${selected ? ' is-selected' : ''}`} aria-label={label} aria-busy={uploading}>
    <div className="pre-repair-photo-label"><span>{required && <b aria-hidden="true">* </b>}{label}</span>{id && action}</div>
    <div className="pre-repair-photo-cover">
      {id ? <AuthenticatedImage fileId={id} alt={imageLabel || `${label}维修前照片`} width="100%" height="100%" /> : slot && <PhotoGuide slot={slot} />}
      {onSelect && <Checkbox className="pre-repair-photo-check" aria-label={selectionLabel || `选择${label}`} disabled={busy} checked={selected} onChange={event => onSelect(event.target.checked)} />}
      {uploading && <div className="pre-repair-photo-loading" role="status"><Spin size="small" /><span>{status || '正在上传…'}</span></div>}
    </div>
    <small className={required && !id ? 'pre-repair-photo-missing' : 'pre-repair-photo-status'}>{id ? '已上传 · 点击查看原图' : required ? '待补拍 · 必拍' : '未上传 · 选填'}</small>
    {!id && slot && <p>{slot === 'mileage' ? '点亮仪表盘，拍清总公里数和单位' : slot === 'front45' ? '拍到完整车头和左侧车身' : '拍到完整车尾和右侧车身'}</p>}
    {!id && action && <div className="pre-repair-empty-action">{action}</div>}
    {error && <div className="pre-repair-photo-error" role="alert">{error}</div>}
  </article>;
}
