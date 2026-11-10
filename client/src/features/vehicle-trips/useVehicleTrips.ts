import { Grid } from 'antd';
import { usePagedList } from '../../shared/hooks/usePagedList';
import { useActionFeedback } from "../../shared/ui/useActionFeedback";
import { useEffect, useRef, useState } from 'react';
import type { CompanyVehicle, VehicleTripDetail, VehicleTripAction, VehicleTripStage } from '../../../../shared/types';
import { createRequestId } from '../../shared/api/requestId';
import { prepareUploadPhoto } from '../../shared/images/prepareOcrImage';
import { companyVehicleApi } from '../company-vehicles/companyVehicleApi';
import { vehicleTripApi } from './vehicleTripApi';

export function useVehicleTrips(initialScope = 'all') {
  const feedback = useActionFeedback();
  const [vehicles, setVehicles] = useState<CompanyVehicle[]>([]);
  const [scope,setScope]=useState(initialScope);
  const mobile=!Grid.useBreakpoint().md;
  const list=usePagedList(scope,page=>vehicleTripApi.page(page,scope),mobile,true,trip=>trip.id);
  const trips=list.items;
  const [detail, setDetail] = useState<VehicleTripDetail>();
  const [busy, setBusy] = useState(true);
  const [pending, setPending] = useState('list');
  const [selectedId, setSelectedId] = useState<string | undefined>(() => new URLSearchParams(location.search).get('vehicleTrip') || undefined);
  const [error, setError] = useState('');
  const [departurePhotos, setDeparturePhotos] = useState<string[]>([]);
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
    setVehicles(await companyVehicleApi.list());
  }

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
  async function uploadImage(id: string, stage: Exclude<VehicleTripStage, "signature">, imageBase64: string, returnRound: number) {
    const key = JSON.stringify({ id, stage, imageBase64, returnRound });
    return vehicleTripApi.upload(id, { stage, imageBase64, returnRound, requestId: requestId(key) });
  }
  return { scope,setScope,list,mobile,vehicles, trips, detail, selectedId, busy:busy||list.loading, pending, error:error||list.error, select,
    departurePhotos,
    addDeparturePhoto: (file: File) => run(async () => {
      if (departurePhotos.length >= 9) throw new Error('最多拍摄 9 张照片');
      const prepared = await prepareUploadPhoto(file);
      if (departurePhotos.reduce((size, photo) => size + photo.length, prepared.imageBase64.length) > 12 * 1024 * 1024) throw new Error('照片总大小过大，请减少照片后重试');
      setDeparturePhotos(current => [...current, prepared.imageBase64]);
    }, undefined, 'prepare-photo'),
    removeDeparturePhoto: (index: number) => { if (!running.current) setDeparturePhotos(current => current.filter((_, i) => i !== index)); },
    refresh: () => run(async () => { await Promise.all([refreshData(),list.refresh()]); if (detail) setDetail(await vehicleTripApi.detail(detail.id)); }),
    create: (values: { vehicleId: string; reason: string; note?: string }) => run(async () => {
      if (!departurePhotos.length) throw new Error('请先拍摄公里数照片');
      const input = { ...values, note: values.note || '', departurePhotos: departurePhotos }; const key = JSON.stringify(input);
      await vehicleTripApi.create({ ...input, requestId: requestId(key) });
      setDeparturePhotos([]); requests.current.delete(key);
      await list.refresh();
    }, '申请已提交，等待审批', 'create'),
    upload: (file: File, stage: 'departure' | 'return') => run(async () => {
      if (!detail) return;
      const prepared = await prepareUploadPhoto(file);
      const attachment = await uploadImage(detail.id, stage, prepared.imageBase64, detail.returnRound);
      setDetail(current => current && current.id === detail.id ? { ...current, attachments: [...current.attachments.filter(a => a.fileId !== attachment.fileId), attachment] } : current);
    }, '照片上传成功', 'upload'),
    act: (action: VehicleTripAction, options: { reason?: string; fileIds?: string[] } = {}) => run(async () => {
      if (!detail) return;
      const fileIds = options.fileIds;
      const input = { fileIds, reason: options.reason, ...(['approve-return', 'reject-return'].includes(action) ? { returnRound: detail.returnRound } : {}) };
      const key = JSON.stringify({ id: detail.id, action, ...input });
      const item = await vehicleTripApi.act(detail.id, action, { ...input, requestId: requestId(key) });
      await list.refresh();
      setDetail(current => current && current.id === item.id ? { ...current, ...item } : current);
      feedback.success(({ approve: '已批准并出车', reject: '申请已驳回', cancel: '申请已取消', depart: '出车登记成功，已记录出车时间', return: '还车已完成，收车时间已记录', 'approve-return': '收车审核通过', 'reject-return': '收车已退回，请申请人重新拍照提交' })[action]);
      setDetail(await vehicleTripApi.detail(item.id));
    }, undefined, action)
  };
}
