import type {VehiclePartsHistory} from '../../../../shared/types';

// Memory only: scoped to the signed-in session and task; fresh inventory is never cached.
export function createVehiclePartsHistoryCache(now=Date.now) {
  const entries=new Map<string,{value?:VehiclePartsHistory;expiresAt:number;pending?:Promise<VehiclePartsHistory>}>();
  return function load(key:string,fetchHistory:()=>Promise<VehiclePartsHistory>,refresh=false) {
    const existing=entries.get(key);
    if(existing?.pending)return existing.pending;
    if(!refresh&&existing?.value&&existing.expiresAt>now())return Promise.resolve(existing.value);
    const entry:{value?:VehiclePartsHistory;expiresAt:number;pending?:Promise<VehiclePartsHistory>}={expiresAt:0};
    const pending=Promise.resolve().then(fetchHistory).then(value=>{
      entry.value=value;entry.expiresAt=now()+10*60*1000;entry.pending=undefined;
      return value;
    },error=>{if(entries.get(key)===entry)entries.delete(key);throw error;});
    entry.pending=pending;entries.delete(key);entries.set(key,entry);
    if(entries.size>30)entries.delete(entries.keys().next().value!);
    return pending;
  };
}
export const loadVehiclePartsHistory=createVehiclePartsHistoryCache();
