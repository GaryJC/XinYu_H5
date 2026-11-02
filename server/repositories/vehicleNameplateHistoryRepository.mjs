import {randomUUID} from 'node:crypto';

export const normalizeVehicleIdentity=value=>String(value||'').replace(/\s/g,'').toUpperCase();

export async function findVehicleNameplateHistory(client,task) {
  const vin=normalizeVehicleIdentity(task.vehicleVin),plate=normalizeVehicleIdentity(task.plate);
  if(vin&&!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)||!vin&&!plate)return undefined;
  const {rows}=await client.query(`select f.*,w.vehicle_plate
    from files f join work_orders w on w.id=f.order_id
    left join dispatch_tasks dt on dt.order_id=w.id
    where w.shop_id=$1 and w.id<>$2 and f.kind='vehicle_nameplate_photo' and f.mime_type like 'image/%'
      and w.status not in ('草稿','待客户签字','待处理纸质委托书')
      and (($3<>'' and f.nameplate_vehicle_vin=$3) or ($3='' and f.nameplate_vehicle_plate=$4))
      and (nullif(dt.data->>'vehicleNameplateFileId','') is null or dt.data->>'vehicleNameplateFileId'=f.id)
    order by f.nameplate_recorded_at desc nulls last,f.created_at desc,f.id desc`,[task.shopId,task.orderId,vin,plate]);
  // A plate can be reassigned. Do not offer an ambiguous or malformed VIN history.
  if(!vin) {
    const vins=rows.map(row=>row.nameplate_vehicle_vin).filter(Boolean);
    if(vins.some(value=>!/^[A-HJ-NPR-Z0-9]{17}$/.test(value))||new Set(vins).size>1)return undefined;
  }
  return rows[0];
}

export async function copyVehicleNameplate(client,source,task,actor,requestId) {
  const id=`file_${randomUUID()}`;
  await client.query(`insert into files(id,order_id,kind,storage_provider,bucket,object_key,original_name,mime_type,size_bytes,
    uploaded_by,upload_request_id,repair_round,nameplate_vehicle_vin,nameplate_vehicle_plate,nameplate_recorded_at,nameplate_source_file_id)
    values($1,$2,'vehicle_nameplate_photo',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[
    id,task.orderId,source.storage_provider,source.bucket,source.object_key,source.original_name,source.mime_type,source.size_bytes,
    actor.id,requestId,task.repairRound||0,source.nameplate_vehicle_vin,normalizeVehicleIdentity(task.plate),
    source.nameplate_recorded_at||source.created_at,source.id
  ]);
  return {id};
}
