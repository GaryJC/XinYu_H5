import { executeSqlServerQuery } from '../database/sqlServerPool.mjs';

export const RUNFENG_WAREHOUSES_QUERY = `
  select w.reid as id,RTRIM(w.bm) as department_code,
    RTRIM(d.mc) as department_name,RTRIM(w.mc) as name
  from dbo.ckxxb w left join dbo.bmxxb d on d.bm=w.bm
  where w.qybz='1' order by w.bm,w.sx,w.mc,w.reid
`;
const warehouseCondition = alias => `(@warehouse_id is null or exists (
  select 1 from dbo.ckxxb w where w.reid=@warehouse_id
    and w.bm=${alias}.bm and w.mc=${alias}.ck and w.qybz='1'))`;
export const escapeStockSearch = value => value.replace(/~/g,'~~').replace(/%/g,'~%').replace(/_/g,'~_').replace(/\[/g,'~[');
export function buildRunfengPartsQuery(tokenCount,exactCodeOnly=false) {
  if(!Number.isInteger(tokenCount)||tokenCount<1||tokenCount>6) throw new Error('Invalid search token count');
  const match=Array.from({length:tokenCount},(_,i)=>`(${['hh','pm','gg','sccj','cx','pym','itemcode'].map(field=>`h.${field} like @term${i} escape '~'`).join(' or ')})`).join(' and ');
  return `select top 31 RTRIM(h.hh) as code,RTRIM(h.pm) as name,RTRIM(h.gg) as specification,
    RTRIM(h.sccj) as manufacturer,RTRIM(h.cx) as models,RTRIM(h.jldw) as unit,RTRIM(h.itemcode) as reference_code
    from dbo.hpxxb h where (h.tybz=0 or h.tybz is null) and ${exactCodeOnly?'h.hh=@exact':match}
    and (@warehouse_id is null or exists(select 1 from dbo.cskcb s where s.hh=h.hh and ${warehouseCondition('s')}))
    and (@in_stock_only=0 or exists(select 1 from dbo.cskcb s where s.hh=h.hh and s.jcsl>0 and ${warehouseCondition('s')}))
    order by case when h.hh=@exact then 0 when h.itemcode=@exact and @exact<>'' then 1 when h.pm=@exact then 2 else 3 end,
      case when exists(select 1 from dbo.cskcb s where s.hh=h.hh and s.jcsl>0 and ${warehouseCondition('s')}) then 0 else 1 end,h.pm,h.hh`;
}
const text = value => String(value??'').trim();
export async function listRunfengWarehouses(execute=executeSqlServerQuery) {
  const result=await execute(RUNFENG_WAREHOUSES_QUERY);
  return (result.recordset||[]).map(r=>({id:Number(r.id),departmentCode:text(r.department_code),departmentName:text(r.department_name),name:text(r.name)}));
}
export async function findRunfengParts({query,tokens,warehouseId,inStockOnly,exactCodeOnly=false},execute=executeSqlServerQuery) {
  const configure=(request,sql)=> {
    request.input('warehouse_id',sql.Int,warehouseId??null);
    request.input('in_stock_only',sql.Bit,inStockOnly);
  };
  const found=await execute(buildRunfengPartsQuery(tokens.length,exactCodeOnly),(request,sql)=>{
    configure(request,sql);request.input('exact',sql.NVarChar(80),query);
    tokens.forEach((token,i)=>request.input(`term${i}`,sql.NVarChar(200),`%${escapeStockSearch(token)}%`));
  });
  const rows=found.recordset||[],candidates=rows.slice(0,30);
  if(!candidates.length)return {items:[],hasMore:false};
  const stock=await execute(`select RTRIM(s.hh) as code,RTRIM(s.bm) as department_code,RTRIM(d.mc) as department_name,
    RTRIM(s.ck) as warehouse,RTRIM(s.hw) as location,sum(s.jcsl) as quantity
    from dbo.cskcb s left join dbo.bmxxb d on d.bm=s.bm
    where s.hh in (${candidates.map((_,i)=>`@code${i}`).join(',')}) and ${warehouseCondition('s')}
    group by s.hh,s.bm,d.mc,s.ck,s.hw
    order by s.hh,s.bm,s.ck,s.hw`,(request,sql)=>{
      configure(request,sql);candidates.forEach((r,i)=>request.input(`code${i}`,sql.VarChar(20),text(r.code)));
    });
  return {hasMore:rows.length>30,items:candidates.map(r=>{
    const stocks=(stock.recordset||[]).filter(s=>text(s.code).toUpperCase()===text(r.code).toUpperCase()).map(s=>({departmentCode:text(s.department_code),departmentName:text(s.department_name),warehouse:text(s.warehouse),location:text(s.location),quantity:s.quantity==null?null:Number(s.quantity)}));
    return {code:text(r.code),name:text(r.name),specification:text(r.specification),manufacturer:text(r.manufacturer),models:text(r.models),unit:text(r.unit),referenceCode:text(r.reference_code),stocks};
  })};
}
