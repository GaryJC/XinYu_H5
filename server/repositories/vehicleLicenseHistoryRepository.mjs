import {randomUUID} from 'node:crypto';
import {HttpError} from '../http/HttpError.mjs';
const normalize=value=>String(value||'').replace(/\s/g,'').toUpperCase();
export async function findVehicleLicenseHistory(client,shopId,input={}) {
  const vin=normalize(input?.vin),plate=normalize(input?.plate);
  if(vin&&!/^[A-Z0-9]{17}$/.test(vin))return undefined;
  if(!vin&&!plate)return undefined;
  const {rows}=await client.query(`select f.*,w.vehicle_plate,coalesce(nullif(f.license_vehicle_vin,''),upper(regexp_replace(w.vehicle_vin,'\\s','','g'))) as matched_vin
    from files f join work_orders w on w.id=f.order_id
    where w.shop_id=$1 and f.kind='vehicle_license' and f.mime_type like 'image/%'
      and not (coalesce(w.inspection->'replacedPhotoIds','[]'::jsonb) ? f.id)
      and (nullif(w.inspection->>'vehicleLicenseFileId','') is null or w.inspection->>'vehicleLicenseFileId'=f.id)
      and ($2::text='' or coalesce(nullif(f.license_vehicle_vin,''),upper(regexp_replace(w.vehicle_vin,'\\s','','g')))=$2)
      and ($2::text<>'' or upper(regexp_replace(w.vehicle_plate,'\\s','','g'))=$3)
      and ($4::text is null or w.id<>$4)
      and ($5::text is null or f.id=$5)
    order by coalesce(f.license_selected_at,f.created_at) desc,f.id desc`,[shopId,vin,plate,input.excludeOrderId||null,input.fileId||null]);
  const valid=rows.filter(row=>/^[A-Z0-9]{17}$/.test(row.matched_vin));
  if(!vin&&new Set(valid.map(row=>row.matched_vin)).size!==1)return undefined;
  return valid[0];
}
export async function copyVehicleLicense(client,source,actor) {
  const id=`file_${randomUUID()}`;
  await client.query(`insert into files(id,kind,storage_provider,bucket,object_key,original_name,mime_type,size_bytes,uploaded_by,license_vehicle_vin,license_source_file_id)
    values($1,'vehicle_license',$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,source.storage_provider,source.bucket,source.object_key,source.original_name,source.mime_type,source.size_bytes,actor.id,source.matched_vin,source.id]);
  return {fileId:id,vin:source.matched_vin};
}
export async function selectSingleVehicleLicense(client,orderId,fileId,inspection,vin) {
  const {rows}=await client.query("select id from files where order_id=$1 and kind='vehicle_license' and id<>$2",[orderId,fileId]);
  const next={...inspection,vehicleLicenseFileId:fileId,replacedPhotoIds:[...new Set([...(inspection?.replacedPhotoIds||[]),...rows.map(row=>row.id)])]};
  await client.query("update files set license_selected_at=coalesce(license_selected_at,clock_timestamp()),license_vehicle_vin=coalesce(license_vehicle_vin,$2) where id=$1",[fileId,normalize(vin)]);
  await client.query('update work_orders set inspection=$2::jsonb where id=$1',[orderId,JSON.stringify(next)]);
  return next;
}
export function assertLicenseReuseIdentity(file,vin) {
  if(file.license_source_file_id&&file.license_vehicle_vin!==normalize(vin))throw new HttpError(409,'复用行驶证与当前 VIN 不符，请重新选择或上传');
}
