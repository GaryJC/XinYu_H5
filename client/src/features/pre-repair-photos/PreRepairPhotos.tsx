import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Grid, Modal } from 'antd';
import { HelpCircle, Trash2 } from 'lucide-react';
import type { PreRepairPhotos as Photos } from '../../../../shared/types';
import { AuthenticatedImagePreviewGroup } from '../../shared/ui/AuthenticatedImage';
import { usePhotoSelection } from '../../shared/ui/PhotoBatchActions';
import { PhotoGuide } from './PhotoGuide';
import { photoSlots, type PhotoSlot } from './photoSlots';
import { PreRepairPhotoCard } from './PreRepairPhotoCard';
import { PreRepairPhotoMenu } from './PreRepairPhotoMenu';
import type { PhotoOperation, PreRepairPhotoControls } from './photoControls';
import './photos.css';

type Props = {
  photos?: Photos; required?: boolean; disabled: boolean; controls?: PreRepairPhotoControls; errors?: string[];
};
type Removal = { label: string; required: boolean; run: () => PhotoOperation };

export function PreRepairPhotos({ photos = {}, disabled, controls, errors = [], required = true }: Props) {
  const mobile = !Grid.useBreakpoint().md;
  const [managing, setManaging] = useState(false);
  const [guide, setGuide] = useState<PhotoSlot>();
  const [removal, setRemoval] = useState<Removal>();
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const mounted = useRef(true);
  const removingRef = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const selection = usePhotoSelection(photos.extra || []);
  const busy = Boolean(controls?.uploading) || removing;
  const editable = !disabled && Boolean(controls);
  const extras = photos.extra || [];
  const missing = photoSlots.filter(slot => slot.required && !photos[slot.key]);
  const progress = controls?.progress;
  const progressText = progress ? `已上传 ${progress.completed}/${progress.total} 张` : '正在上传…';

  useEffect(() => {
    if (!editable || !extras.length) { setManaging(false); selection.clear(); }
    if (!editable) { setRemoval(undefined); setGuide(undefined); }
  }, [editable, extras.length]);

  function requestRemoval(label: string, run: () => PhotoOperation, isRequired = false) {
    setRemoveError(''); setRemoval({ label, run, required: isRequired });
  }
  async function confirmRemoval() {
    if (!removal || busy || removingRef.current || !editable) return;
    removingRef.current = true; setRemoving(true); setRemoveError('');
    try {
      if (await removal.run() === false) {
        if (mounted.current) setRemoveError('删除失败，照片和选中状态已保留，请重试。');
        return;
      }
      if (mounted.current) { selection.clear(); setRemoval(undefined); }
    } catch (cause) {
      if (mounted.current) setRemoveError(cause instanceof Error ? cause.message : '删除失败，请重试');
    } finally {
      removingRef.current = false;
      if (mounted.current) setRemoving(false);
    }
  }
  const guidance = (slot: PhotoSlot) => <Button type="text" icon={<HelpCircle size={16} />} onClick={() => setGuide(slot)}>拍摄指引</Button>;
  const standardAction = (slot: typeof photoSlots[number], id?: string) => {
    if (!editable || !controls) return null;
    const remove = id && (controls.removePhoto ? () => controls.removePhoto!(id)
      : slot.key === 'mileage' && controls.removeMileage ? controls.removeMileage : undefined);
    return <PreRepairPhotoMenu key={id || slot.key} label={`${slot.label}照片`} adding={!id} busy={busy} mobile={mobile}
      removeLabel={controls.removePhoto ? `删除${slot.label}照片` : "移除公里数照片"}
      onSelect={file => controls.upload(slot.key, file)} guide={id ? guidance(slot.key) : undefined}
      onRemove={remove ? () => requestRemoval(slot.label, remove, required && slot.required) : undefined} />;
  };
  return <section className="pre-repair-photos" aria-label="车辆维修前照片">
    <div className="pre-repair-photos-heading"><h3>维修前照片</h3><span className={required && !missing.length ? 'is-complete' : undefined}>{required ? `必拍已完成 ${2 - missing.length}/2` : '选填'}</span></div>
    {required && missing.length > 0 && <p className="pre-repair-missing-summary">待补：{missing.map(slot => slot.label).join('、')}</p>}
    {!required && <p>纸质委托书已提供，维修前照片可按需补充。</p>}
    {!removal && controls?.error && <Alert type="error" showIcon title={controls.error} />}
    {controls?.successMessage && <Alert type="success" showIcon title={controls.successMessage} />}
    <AuthenticatedImagePreviewGroup fileIds={[...photoSlots.map(slot => photos[slot.key]).filter((id): id is string => Boolean(id)), ...extras]}>
      <div className="pre-repair-group-heading"><h4>标准角度</h4><span>点击实拍照片查看原图</span></div>
      <div className="pre-repair-photo-grid">
        {photoSlots.map(slot => <PreRepairPhotoCard key={slot.key} label={slot.label} id={photos[slot.key]} slot={slot.key}
          required={required && slot.required} busy={busy} uploading={controls?.uploading === slot.key} status={progressText}
          error={!photos[slot.key] ? errors.find(error => error.includes(slot.label)) : undefined} action={standardAction(slot, photos[slot.key])} />)}
      </div>
      <div className="pre-repair-group-heading"><h4>补充照片 <span>{extras.length} 张</span></h4>
        {editable && <div className="pre-repair-heading-actions">
          {Boolean(extras.length && controls?.removeExtras) && <Button icon={managing ? undefined : <Trash2 size={16}/>} disabled={busy} onClick={() => { setManaging(!managing); selection.clear(); }}>{managing ? '完成' : '多选删除'}</Button>}
          {!managing && controls && <PreRepairPhotoMenu label="补充照片" sourceLabel="维修前额外照片" adding multiple busy={busy} mobile={mobile}
            onSelect={file => controls.upload('extra', file)} onSelectMany={controls.uploadExtras} />}
        </div>}
      </div>
      {managing && editable && Boolean(extras.length) && <div className="pre-repair-batch">
        <Checkbox disabled={busy} checked={selection.selectedIds.length === extras.length} indeterminate={Boolean(selection.selectedIds.length && selection.selectedIds.length < extras.length)} onChange={event => selection.selectAll(event.target.checked)}>全选补充照片</Checkbox>
        <span>已选 {selection.selectedIds.length} 张</span>
        <Button type="text" danger icon={<Trash2 size={16} />} disabled={busy || !selection.selectedIds.length} onClick={() => {
          const ids = [...selection.selectedIds];
          requestRemoval(`选中的 ${ids.length} 张补充照片`, () => controls!.removeExtras!(ids));
        }}>删除所选</Button>
      </div>}
      {['extra','other'].includes(controls?.uploading || '') && <div className="pre-repair-upload-progress" role="status">{controls?.uploading === 'extra' ? '正在上传补充照片' : '正在更新照片'} · {progressText}</div>}
      {extras.length ? <div className="pre-repair-photo-grid">
        {extras.map((id, index) => <PreRepairPhotoCard key={id} label={`补充照片 ${index + 1}`} imageLabel={`维修前额外照片 ${index + 1}`} selectionLabel={`选择额外照片 ${index + 1}`} id={id} busy={busy} uploading={false}
          selected={selection.selectedIds.includes(id)} onSelect={managing && editable ? checked => selection.toggle(id, checked) : undefined}
          action={editable && !managing && controls && (controls.replaceExtra || controls.removeExtra) ? <PreRepairPhotoMenu label={`补充照片 ${index + 1}`} sourceLabel={`额外照片 ${index + 1}重新上传`} removeLabel={`移除额外照片 ${index + 1}`} busy={busy} mobile={mobile}
            onSelect={controls.replaceExtra ? file => controls.replaceExtra!(id, file) : undefined}
            onRemove={controls.removeExtra ? () => requestRemoval(`补充照片 ${index + 1}`, () => controls.removeExtra!(id)) : undefined} /> : undefined} />)}
      </div> : <p className="pre-repair-extras-empty">暂无补充照片{editable ? '，可添加划痕、凹陷、内饰等细节照片。' : '。'}</p>}
    </AuthenticatedImagePreviewGroup>
    <Modal title="拍摄指引" open={Boolean(guide)} onCancel={() => setGuide(undefined)} footer={<Button onClick={() => setGuide(undefined)}>关闭</Button>} zIndex={1400} width={420}>
      {guide && <><PhotoGuide slot={guide} /><p>{photoSlots.find(slot => slot.key === guide)?.hint}</p></>}
    </Modal>
    <Modal title={`删除${removal?.label || '照片'}？`} open={Boolean(removal)} onCancel={() => { if (!busy) setRemoval(undefined); }} zIndex={1500}
      okText="删除照片" cancelText="取消" okButtonProps={{ danger: true, disabled: !editable || Boolean(controls?.uploading) }} confirmLoading={removing} cancelButtonProps={{ disabled: busy }} closable={!busy} mask={{ closable: !busy }} onOk={() => void confirmRemoval()}>
      <p>{removal?.required ? '这是必拍角度，删除后需要重新补齐才能继续签字。' : '删除后将不再展示在当前委托单中。'}</p>
      {(removeError || controls?.error) && <Alert type="error" showIcon title={controls?.error || removeError} />}
    </Modal>
  </section>;
}
