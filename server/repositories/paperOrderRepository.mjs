import { randomUUID } from 'node:crypto';
import { HttpError } from '../http/HttpError.mjs';

export function assertPaperPhotoIds(paper) {
  const ids = paper?.photoIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some(id => typeof id !== 'string' || !id.trim())
      || new Set(ids).size !== ids.length) throw new HttpError(400, '请上传纸质委托书照片（最多 50 张）');
  return ids;
}
export async function attachPaperPhotos(client, order, userId) {
  const ids = assertPaperPhotoIds(order.paperOrder);
  const { rows } = await client.query(`select id from files where id=any($1::text[]) and kind='other'
    and mime_type in ('image/jpeg','image/png','image/webp')
    and (order_id=$2 or (order_id is null and uploaded_by=$3)) order by id for update`, [ids,order.id,userId]);
  if (rows.length !== ids.length) throw new HttpError(400,'纸质委托书照片不存在、无权使用或已关联其他委托单');
  await client.query('update files set order_id=$2 where id=any($1::text[])',[ids,order.id]);
}
export async function enqueuePaperNotifications(client, order) {
  const { rows } = await client.query("select id from users where active=true and role in ('advisor','manager')");
  for (const user of rows) await client.query(`insert into dispatch_notifications(id,order_id,recipient_id,kind,payload)
    values($1,$2,$3,'纸质委托书已创建',$4::jsonb) on conflict do nothing`,
    [randomUUID(),order.id,user.id,JSON.stringify({ orderId:order.id, paperOrder:true, summary:`${order.advisor} 创建了纸质委托书，请选择关联润丰派工单或在钉钉补全开单。` })]);
}
export async function lockPaperOrder(client, id, actor) {
  const { rows } = await client.query('select * from work_orders where id=$1 for update',[id]);
  const order=rows[0];
  if (!order) throw new HttpError(404,'委托单不存在');
  if (!actor?.active || !['advisor','manager'].includes(actor.role) || !actor.shopId || order.shop_id!==actor.shopId) throw new HttpError(403,'无权处理此纸质委托书');
  if (!order.paper_order) throw new HttpError(409,'此委托单不是纸质委托书');
  return order;
}
export async function assertLegacyLinkAvailable(client, id, header) {
  // Serialize links to the same source even when two different paper orders are processed concurrently.
  await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`runfeng:${header.reid}:${header.dh}`]);
  const { rows }=await client.query(`select id from work_orders where id<>$1 and
    ((legacy_reid=$2 and legacy_document_no=$3) or dispatch_no=$4) limit 1`,[id,header.reid,header.dh,String(header.pgd).trim()]);
  if (rows.length) throw new HttpError(409,`润丰派工单已关联委托单 ${rows[0].id}`);
}
export async function assertPaperDraftUnsubmitted(client, order) {
  if (Number(order.legacy_sync_revision) !== 0 || order.legacy_sync_status !== 'not_applicable'
      || order.legacy_reid != null || order.legacy_document_no != null || order.dispatch_no) {
    throw new HttpError(409,'此委托单已提交或关联润丰，不能更改开单方式');
  }
  const { rows } = await client.query(`select 1 where
    exists(select 1 from legacy_sync_outbox where order_id=$1)
    or exists(select 1 from dispatch_tasks where order_id=$1)`, [order.id]);
  if (rows.length) throw new HttpError(409,'此委托单已有同步或派工记录，不能更改开单方式');
}
export async function setPaperMode(client,id,mode,status,actor) {
  await client.query(`update work_orders set paper_order=jsonb_set(paper_order,'{mode}',to_jsonb($2::text)),
    status=$3,advisor=case when $2='dingtalk' then $4 else advisor end,updated_at=now() where id=$1`,[id,mode,status,actor.name]);
  await client.query('insert into audit_logs(order_id,actor,action) values($1,$2,$3)',[id,actor.name,mode==='runfeng'?'纸质委托书关联润丰派工单':'纸质委托书选择在钉钉创建']);
}

export async function markPaperLegacySynced(client,id) {
  await client.query("update work_orders set legacy_sync_status='synced',legacy_synced_at=now(),legacy_sync_error=null where id=$1",[id]);
}
export async function auditPaperSubmission(client,id,actor) {
  await client.query('insert into audit_logs(order_id,actor,action) values($1,$2,$3)',[id,actor.name,'凭纸质委托书完成开单，免电子签字']);
}
