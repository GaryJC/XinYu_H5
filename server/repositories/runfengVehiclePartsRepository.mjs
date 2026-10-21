import {executeSqlServerQuery} from '../database/sqlServerPool.mjs';
const text=value=>String(value??'').trim();
export const VEHICLE_PARTS_ORDERS_QUERY=`select top 51 w.reid as id,w.dh as order_no,
  RTRIM(w.pgd) as dispatch_no,RTRIM(w.jcrq) as repaired_at,RTRIM(w.cx) as vehicle_model
  from dbo.qxwxb w where w.wd='' and isnull(w.del,'')<>'1'
  and REPLACE(REPLACE(UPPER(RTRIM(w.ch)),' ',''),'-','')=@plate
  and (@exclude_dispatch='' or RTRIM(w.pgd)<>@exclude_dispatch)
  order by w.jcrq desc,w.reid desc`;
export async function findVehiclePartsHistory({plate,excludeDispatch},execute=executeSqlServerQuery) {
  const orders=await execute(VEHICLE_PARTS_ORDERS_QUERY,(request,sql)=>{
    request.input('plate',sql.NVarChar(20),plate);request.input('exclude_dispatch',sql.NVarChar(100),excludeDispatch||'');
  });
  const heads=orders.recordset||[],recent=heads.slice(0,50);
  if(!recent.length)return {status:'no_history',items:[],hasMore:false};
  const details=await execute(`select top 501 m.reid as id,m.dh as order_no,RTRIM(m.hh0) as code,
    RTRIM(m.hh) as name,RTRIM(m.gg) as specification,RTRIM(m.cd) as manufacturer,
    RTRIM(m.jldw) as unit,m.sl as quantity
    from dbo.qxwxmxb m where m.wd='' and m.lb='材料' and m.sl>0
    and m.dh in (${recent.map((_,i)=>`@order${i}`).join(',')}) order by m.reid desc`,(request,sql)=>{
      recent.forEach((r,i)=>request.input(`order${i}`,sql.Int,r.order_no));
    });
  const raw=details.recordset||[],rows=raw.slice(0,500);
  const variants=new Map(),latestByName=new Map();
  for(const order of recent) {
    for(const row of rows.filter(r=>r.order_no===order.order_no)) {
      const code=text(row.code),name=text(row.name),specification=text(row.specification),unit=text(row.unit),manufacturer=text(row.manufacturer);
      // Keep every variant from the latest repair for this material name only.
      const material=name.toUpperCase().replace(/\s+/g,'')||code.toUpperCase();
      if(latestByName.has(material)&&latestByName.get(material)!==String(order.id))continue;
      latestByName.set(material,String(order.id));
      const key=JSON.stringify([code.toUpperCase()||name,specification,unit,manufacturer]);
      const found=variants.get(key);
      if(found){if(found.repairOrderId===String(order.id))found.quantity+=Number(row.quantity);continue;}
      variants.set(key,{code,name,specification,unit,manufacturer,quantity:Number(row.quantity),lastUsedAt:text(order.repaired_at),dispatchNo:text(order.dispatch_no),repairOrderId:String(order.id),vehicleModel:text(order.vehicle_model)});
    }
  }
  return {status:variants.size?'found':'no_parts',items:[...variants.values()].slice(0,60),hasMore:heads.length>50||raw.length>500||variants.size>60};
}
