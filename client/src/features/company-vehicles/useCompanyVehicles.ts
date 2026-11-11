import { useActionFeedback } from "../../shared/ui/useActionFeedback";
import { useEffect, useRef, useState } from 'react';
import type { CompanyVehicle, CompanyVehicleInput, CompanyVehicleImportRow } from '../../../../shared/types';
import { companyVehicleApi } from './companyVehicleApi';

export function useCompanyVehicles() {
  const feedback = useActionFeedback();
  const [vehicles, setVehicles] = useState<CompanyVehicle[]>([]);
  const [importData,setImportData]=useState<{fileBase64:string;rows:CompanyVehicleImportRow[]}>();
  const [search, setSearch] = useState('');
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
  const query = search.trim().toLocaleLowerCase();
  const filteredVehicles = vehicles.filter(vehicle =>
    [vehicle.plate, vehicle.brand, vehicle.model].some(value => value.toLocaleLowerCase().includes(query))
  );
  return { importData, cancelImport:()=>setImportData(undefined),
    previewImport:(file:File)=>run(async()=>{
      if(!file.name.toLowerCase().endsWith('.xlsx')||file.size>3*1024*1024)throw new Error('请选择不超过 3 MB 的 .xlsx 文件');
      const fileBase64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('文件读取失败'));reader.readAsDataURL(file);});
      const result=await companyVehicleApi.importFile(fileBase64,true);setImportData({fileBase64,rows:result.rows||[]});
    }),
    confirmImport:()=>run(async()=>{if(!importData)return;await companyVehicleApi.importFile(importData.fileBase64,false);setImportData(undefined);await load();},'车辆及保险信息已更新'),
    vehicles, filteredVehicles, search, setSearch, busy, loading, error, refresh: () => run(load),
    save: (input: CompanyVehicleInput, id?: string) => run(async () => { const saved = await companyVehicleApi.save(input, id); setVehicles(current => [saved, ...current.filter(v => v.id !== saved.id)].sort((a, b) => a.plate.localeCompare(b.plate))); }, id ? '车辆信息已保存' : '公司车辆已录入') };
}
