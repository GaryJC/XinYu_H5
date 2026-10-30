import { pool } from '../database/pool.mjs';
import { HttpError } from '../http/HttpError.mjs';
import { pagination } from '../domain/pagination.mjs';

// Match the archive's display status, including signature review and active repair rounds.
const stage = `case when wo.customer_signature_review->>'state'='pending'
  and coalesce(wo.customer_signature_review->>'supplemental','false')<>'true' then '需确认用户签字'
  when wo.status in ('草稿','待客户签字','待处理纸质委托书') then wo.status
  else coalesce(dt.stage,case when wo.status in ('待结算','完成') then '维修完成'
    when wo.status='维修中' then '维修中' else '待派工' end) end`;
const category = `case when (${stage}) in ('待结算','完成','维修完成') then '已完成' else (${stage}) end`;
const person = column => `case when trim(coalesce(${column},'')) in ('','待派工','未分配') then '未分配' else trim(${column}) end`;
const source = 'from work_orders wo left join dispatch_tasks dt on dt.order_id=wo.id';

export function archiveQuery(scope, query = {}) {
  const params = [...scope.params];
  const bind = value => { params.push(value); return `$${params.length}`; };
  const clauses = [scope.where.replace(/^where /, '')];
  if (query.shopId) clauses.push(`wo.shop_id=${bind(query.shopId)}`);
  if (query.search?.trim()) {
    const term = bind(query.search.trim().toLowerCase());
    clauses.push(`(${['wo.id','wo.dispatch_no','wo.vehicle_plate','wo.vehicle_vin','wo.vehicle_model','wo.customer_name'].map(c => `strpos(lower(coalesce(${c},'')),${term})>0`).join(' or ')})`);
  }
  if (query.baiyuanOnly === 'true') clauses.push('wo.is_baiyuan_order=true');
  for (const [key, op] of [['from','>='],['to','<']]) if (query[key]) {
    if (!Number.isFinite(Date.parse(query[key]))) throw new HttpError(400, '日期筛选无效');
    clauses.push(`wo.created_at ${op} ${bind(query[key])}::timestamptz`);
  }
  for (const key of ['statuses','advisors','technicians']) if (query[key]) {
    let values;
    try { values = JSON.parse(query[key]); } catch { throw new HttpError(400, '筛选参数无效'); }
    if (!Array.isArray(values) || values.length > 100 || values.some(v => typeof v !== 'string')) throw new HttpError(400, '筛选参数无效');
    if (!values.length) continue;
    if (key === 'statuses') clauses.push(`(${category})=any(${bind(values.map(v => ['待结算','完成','维修完成'].includes(v)?'已完成':v))}::text[])`);
    if (key === 'advisors') clauses.push(`(${person('wo.advisor')})=any(${bind(values)}::text[])`);
    if (key === 'technicians') clauses.push(`exists(select 1 from regexp_split_to_table(coalesce(wo.technician,''),'[、,，;；]') name where (${person('name')})=any(${bind(values)}::text[]))`);
  }
  const sorts = { 'updated-desc':'wo.updated_at desc', 'updated-asc':'wo.updated_at asc', 'created-desc':'wo.created_at desc', 'created-asc':'wo.created_at asc' };
  if (query.sort && !sorts[query.sort]) throw new HttpError(400, '排序参数无效');
  return { where: `where ${clauses.map(c => `(${c})`).join(' and ')}`, params, order: `${sorts[query.sort] || sorts['updated-desc']} nulls last, wo.id asc` };
}

export async function workOrderPageRows(scope, query, database = pool) {
  const { where, params, order } = archiveQuery(scope, query);
  const { pageSize, page: requested } = pagination(query);
  const { rows: [counts] } = await database.query(`select count(*)::integer as total ${source} ${where}`, params);
  const page = Math.min(requested, Math.max(1, Math.ceil(counts.total / pageSize)));
  const { rows } = await database.query(`select wo.*, dt.stage as dispatch_stage, st.token as signature_token, st.used as signature_token_used
    ${source} left join lateral (select token,used from signature_tokens where order_id=wo.id order by created_at desc limit 1) st on true
    ${where} order by ${order} limit $${params.length+1} offset $${params.length+2}`, [...params,pageSize,(page-1)*pageSize]);
  return { rows, total: counts.total, page, pageSize };
}

export async function archiveMetadata(scope, database = pool) {
  const { rows } = await database.query(`select distinct ${category} as status, ${person('wo.advisor')} as advisor, coalesce(wo.technician,'') as technician ${source} ${scope.where}`, scope.params);
  const unique = values => [...new Set(values)].sort((a,b)=>a.localeCompare(b,'zh-CN')).map(value=>({value,label:value}));
  return { statuses: unique(rows.map(r=>r.status)), advisors: unique(['未分配',...rows.map(r=>r.advisor)]),
    technicians: unique(['未分配',...rows.flatMap(r=>r.technician.split(/[、,，;；]/).map(n=>!n.trim()||['待派工','未分配'].includes(n.trim())?'未分配':n.trim()))]) };
}

export async function refreshTargetIds(scope, user, database = pool) {
  const { rows } = await database.query(`select wo.id from work_orders wo ${scope.where}
    and wo.shop_id=$${scope.params.length+1} and ($${scope.params.length+2} or wo.advisor=$${scope.params.length+3})
    and wo.legacy_sync_status='synced' and wo.status not in ('草稿','待客户签字') order by wo.id`,
    [...scope.params,user.shopId,user.role==='manager'||user.roles?.includes('manager')||false,user.name]);
  return rows.map(r=>r.id);
}
