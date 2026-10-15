export function mapLicenseException(row) {
  return {id:row.id,reason:row.reason,vehiclePlate:row.vehicle_plate,vehicleVin:row.vehicle_vin,reportedBy:row.reported_by,reportedName:row.reported_name,reportedAt:new Date(row.reported_at).toISOString(),notificationStatus:Number(row.delivery_failed)>0?'failed':Number(row.delivery_unknown)>0?'unknown':Number(row.delivery_total)>0&&Number(row.delivery_sent)===Number(row.delivery_total)?'sent':row.status,notificationError:row.error||row.delivery_error||''};
}
export async function readLicenseExceptions(client,ids) {
  const {rows}=await client.query(`select e.*,n.* from vehicle_license_exceptions e left join lateral (select count(*) as delivery_total,count(*) filter(where status='sent') as delivery_sent,count(*) filter(where status='failed') as delivery_failed,count(*) filter(where status='unknown' and (locked_until is null or locked_until<now())) as delivery_unknown,string_agg(distinct nullif(error,''),'；') as delivery_error from vehicle_license_exception_notifications where exception_id=e.id) n on true where e.order_id=any($1::text[]) order by e.reported_at desc,e.id desc`,[ids]);
  const result=new Map();
  for(const row of rows)if(!result.has(row.order_id))result.set(row.order_id,mapLicenseException(row));
  return result;
}

export async function lockLicenseOrder(client,id) {return (await client.query('select * from work_orders where id=$1 for update',[id])).rows[0];}
export async function licenseActor(client,id) {return (await client.query('select id,name,role,active,shop_id from users where id=$1',[id])).rows[0];}
export async function licenseRequest(client,id,requestId) {return (await client.query('select * from vehicle_license_exceptions where order_id=$1 and request_id=$2',[id,requestId])).rows[0];}
export async function orderHasLicense(client,id) {return Boolean((await client.query("select id from files where order_id=$1 and kind='vehicle_license' limit 1",[id])).rows.length);}
export async function latestLicenseReport(client,id) {return (await client.query('select * from vehicle_license_exceptions where order_id=$1 order by reported_at desc,id desc limit 1',[id])).rows[0];}
export async function insertLicenseReport(client,{id,orderId,requestId,plate,vin,reason,user,payload}) {
  const {rows:[saved]}=await client.query(`insert into vehicle_license_exceptions(id,order_id,request_id,vehicle_plate,vehicle_vin,reason,reported_by,reported_name,payload)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,[id,orderId,requestId,plate,vin,reason,user.id,user.name,JSON.stringify(payload)]);
  await client.query('insert into audit_logs(order_id,actor,action) values($1,$2,$3)',[orderId,user.name,`行驶证缺失备案：${reason}`]);
  return saved;
}
