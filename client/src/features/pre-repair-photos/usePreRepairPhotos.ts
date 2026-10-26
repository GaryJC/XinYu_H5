import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { PreRepairPhotos, WorkOrderDraft } from '../../../../shared/types';
import { prepareUploadPhoto } from '../../shared/images/prepareOcrImage';
import { workOrderApi } from '../work-orders/api/workOrderApi';
import type { PhotoSlot } from './photoSlots';

export function usePreRepairPhotos(setDraft: Dispatch<SetStateAction<WorkOrderDraft>>, photos: PreRepairPhotos = {}) {
  const generation = useRef(0);
  const inFlight = useRef(false);
  const latestPhotos = useRef(photos);
  latestPhotos.current = photos;
  const [uploading, setUploading] = useState<PhotoSlot | 'extra' | ''>('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [progress, setProgress] = useState<{ completed: number; total: number }>();
  const [sessionId, setSessionId] = useState(0);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(''), 3000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  function reset() {
    generation.current++; inFlight.current = false;
    setSessionId(value => value + 1);
    setUploading(''); setError(''); setSuccessMessage(''); setProgress(undefined);
  }
  async function uploadMany(slot: PhotoSlot | 'extra', files: File[], replaceFileId?: string) {
    if (inFlight.current || !files.length) return false;
    setError(''); setSuccessMessage('');
    if (files.some(file => !file.type.startsWith('image/'))) { setError('请选择照片文件'); return false; }
    inFlight.current = true;
    const session = generation.current;
    const replacing = Boolean(replaceFileId || (slot !== 'extra' && latestPhotos.current[slot]));
    setUploading(slot); setProgress({ completed: 0, total: files.length });
    let completed = 0;
    try {
      // Process sequentially to keep large mobile images within WebView memory limits.
      for (const file of files) {
        const image = await prepareUploadPhoto(file, slot === 'front45' || slot === 'rear45' ? new Date() : undefined);
        if (generation.current !== session) return false;
        const stored = await workOrderApi.uploadFile({ kind: 'repair_order_photo', ...image });
        if (generation.current !== session) return false;
        setDraft(current => {
          if (generation.current !== session) return current;
          const currentPhotos = current.inspection.preRepairPhotos || {};
          return { ...current, inspection: { ...current.inspection, preRepairPhotos: {
            ...currentPhotos,
            ...(slot === 'extra' ? { extra: replaceFileId ? (currentPhotos.extra || []).map(id => id === replaceFileId ? stored.id : id) : [...(currentPhotos.extra || []), stored.id] } : { [slot]: stored.id })
          } } };
        });
        completed++; setProgress({ completed, total: files.length });
      }
      setSuccessMessage(replacing ? '已更换' : '已添加');
      return true;
    } catch (cause) {
      if (generation.current === session) setError(`${completed ? `已上传 ${completed} 张，剩余照片请重新选择。` : ''}${cause instanceof Error ? cause.message : '照片上传失败，请重试'}`);
      return false;
    } finally {
      if (generation.current === session) { inFlight.current = false; setUploading(''); setProgress(undefined); }
    }
  }
  function removeExtras(ids: string[]) {
    if (inFlight.current || !ids.length) return false;
    const session = generation.current;
    setError(''); setSuccessMessage('已删除');
    setDraft(current => generation.current !== session ? current : ({ ...current, inspection: { ...current.inspection, preRepairPhotos: {
      ...current.inspection.preRepairPhotos, extra: (current.inspection.preRepairPhotos?.extra || []).filter(id => !ids.includes(id))
    } } }));
    return true;
  }
  function removeMileage() {
    if (inFlight.current) return false;
    const session = generation.current;
    setError(''); setSuccessMessage('已删除');
    setDraft(current => generation.current !== session ? current : ({ ...current, inspection: { ...current.inspection, preRepairPhotos: {
      ...current.inspection.preRepairPhotos, mileage: undefined
    } } }));
    return true;
  }
  return { uploading, error, successMessage, progress, sessionId, reset, removeExtras, removeExtra: (id: string) => removeExtras([id]), removeMileage,
    upload: (slot: PhotoSlot | 'extra', file: File) => uploadMany(slot, [file]),
    uploadExtras: (files: File[]) => uploadMany('extra', files),
    replaceExtra: (id: string, file: File) => uploadMany('extra', [file], id),
    isUploading: () => inFlight.current };
}
