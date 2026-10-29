import { useActionFeedback } from "../../shared/ui/useActionFeedback";
import { useEffect, useRef, useState } from 'react';
import type { CompanyVehicle, CompanyVehicleInput } from '../../../../shared/types';
import { companyVehicleApi } from './companyVehicleApi';

export function useCompanyVehicles() {
  const feedback = useActionFeedback();
  const [vehicles, setVehicles] = useState<CompanyVehicle[]>([]);
  const [busy, setBusy] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const running = useRef(false);
  async function load() { setVehicles(await companyVehicleApi.list(true)); }
  async function run(action: () => Promise<void>, success?: string) {
    if (running.current) return false;
    running.current = true; setBusy(true); setLoading(!success); setError('');
    try { await action(); if (success) feedback.success(success); return true; }
    catch (e) { feedback.error(e, '车辆操作失败'); setError(e instanceof Error ? e.message : '车辆操作失败'); return false; }
    finally { running.current = false; setBusy(false); setLoading(false); }
  }
  useEffect(() => { void run(load); }, []);
  return { vehicles, busy, loading, error, refresh: () => run(load),
    save: (input: CompanyVehicleInput, id?: string) => run(async () => { const saved = await companyVehicleApi.save(input, id); setVehicles(current => [saved, ...current.filter(v => v.id !== saved.id)].sort((a, b) => a.plate.localeCompare(b.plate))); }, id ? '车辆信息已保存' : '公司车辆已录入') };
}
