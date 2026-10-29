import { useActionFeedback } from "../../shared/ui/useActionFeedback";
import { useEffect, useRef, useState } from 'react';
import type { CompanyVehicle, VehicleTrip, VehicleTripDetail, VehicleTripAction, VehicleTripStage } from '../../../../shared/types';
import { createRequestId } from '../../shared/api/requestId';
import { prepareUploadPhoto } from '../../shared/images/prepareOcrImage';
import { companyVehicleApi } from '../company-vehicles/companyVehicleApi';
import { vehicleTripApi } from './vehicleTripApi';

export function useVehicleTrips() {
  const feedback = useActionFeedback();
  const [vehicles, setVehicles] = useState<CompanyVehicle[]>([]);
  const [trips, setTrips] = useState<VehicleTrip[]>([]);
  const [detail, setDetail] = useState<VehicleTripDetail>();
  const [busy, setBusy] = useState(true);
  const [pending, setPending] = useState('list');
  const [selectedId, setSelectedId] = useState<string | undefined>(() => new URLSearchParams(location.search).get('vehicleTrip') || undefined);
  const [error, setError] = useState('');
  const requests = useRef(new Map<string, string>());
  const running = useRef(false);
  const selection = useRef(0);
  const mounted = useRef(false);
  function requestId(key: string) {
    if (!requests.current.has(key)) requests.current.set(key, createRequestId());
    return requests.current.get(key)!;
  }
  async function run(action: () => Promise<void>, success?: string, operation = 'list') {
    if (running.current) return false;
    running.current = true; setBusy(true); setPending(operation); setError('');
    try { await action(); if (success) feedback.success(success); return true; }
    catch (e) { feedback.error(e); setError(e instanceof Error ? e.message : '操作失败，请重试'); return false; }
    finally { running.current = false; setBusy(false); setPending(''); }
  }
  async function refreshData() {
    const [cars, items] = await Promise.all([companyVehicleApi.list(), vehicleTripApi.list()]);
    setVehicles(cars); setTrips(items);
  }
  function upsert(item: VehicleTrip) { setTrips(items => [item, ...items.filter(t => t.id !== item.id)]); }
  function select(id?: string) {
    const url=new URL(location.href);
    if(id)url.searchParams.set('vehicleTrip',id);else url.searchParams.delete('vehicleTrip');
    history.replaceState(null,'',url);
    const revision = ++selection.current;
    setSelectedId(id); setDetail(undefined); setError('');
    if (id) void run(async () => { const next = await vehicleTripApi.detail(id); if (selection.current === revision) setDetail(next); }, undefined, 'detail');
  }
  useEffect(() => {
    const revision=selection.current;mounted.current=true;
    const id=new URLSearchParams(location.search).get('vehicleTrip');
    void run(async()=>{
      await refreshData();
      if(id){const next=await vehicleTripApi.detail(id);if(mounted.current&&selection.current===revision)setDetail(next);}
    },undefined,id?'detail':'list');
    return()=>{mounted.current=false;};
  }, []);
  async function uploadImage(id: string, stage: Exclude<VehicleTripStage, "signature">, imageBase64: string) {
    const key = JSON.stringify({ id, stage, imageBase64 });
    return vehicleTripApi.upload(id, { stage, imageBase64, requestId: requestId(key) });
  }
  return { vehicles, trips, detail, selectedId, busy, pending, error, select,
    refresh: () => run(async () => { await refreshData(); if (detail) setDetail(await vehicleTripApi.detail(detail.id)); }),
    create: (values: { vehicleId: string; reason: string; note?: string }) => run(async () => {
      const input = { ...values, note: values.note || '' }; const key = JSON.stringify(input);
      const item = await vehicleTripApi.create({ ...input, requestId: requestId(key) });
      upsert(item); requests.current.delete(key);
    }, '出车申请已提交，等待审批', 'create'),
    upload: (file: File, stage: 'departure' | 'return') => run(async () => {
      if (!detail) return;
      const prepared = await prepareUploadPhoto(file);
      const attachment = await uploadImage(detail.id, stage, prepared.imageBase64);
      setDetail(current => current && current.id === detail.id ? { ...current, attachments: [...current.attachments.filter(a => a.fileId !== attachment.fileId), attachment] } : current);
    }, '照片上传成功', 'upload'),
    act: (action: VehicleTripAction, options: { reason?: string; fileIds?: string[] } = {}) => run(async () => {
      if (!detail) return;
      const fileIds = options.fileIds;
      const input = { fileIds, reason: options.reason };
      const key = JSON.stringify({ id: detail.id, action, ...input });
      const item = await vehicleTripApi.act(detail.id, action, { ...input, requestId: requestId(key) });
      upsert(item);
      setDetail(current => current && current.id === item.id ? { ...current, ...item } : current);
      feedback.success(({ approve: '申请已批准', reject: '申请已驳回', cancel: '申请已取消', depart: '出车登记成功，已记录出车时间', return: '还车登记成功，已记录收车时间' })[action]);
      setDetail(await vehicleTripApi.detail(item.id));
    }, undefined, action)
  };
}
