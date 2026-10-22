import { hasRole, hasAnyRole } from "../../shared/roles.mjs";
import { randomUUID } from 'node:crypto';
import { pool } from '../database/pool.mjs';

export async function queueCustomerSignatureReview(client, order, { supplemental = false } = {}) {
  const signedAt = new Date().toISOString();
  await client.query(`update work_orders set customer_signature_review=$2::jsonb where id=$1`,
    [order.id, JSON.stringify({ state: 'pending', signedAt, ...(supplemental ? { supplemental: true } : {}) })]);
  const { rows } = await client.query(`select id from users where active and shop_id=$1
    and ((role='manager' or 'manager'=any(roles)) or ((role='advisor' or 'advisor'=any(roles)) and name=$2))`, [order.shop.id, order.advisor]);
  for (const user of rows) await client.query(`insert into dispatch_notifications(id,order_id,recipient_id,kind,payload)
    values($1,$2,$3,'需确认用户签字',$4::jsonb) on conflict do nothing`,
    [randomUUID(), order.id, user.id, JSON.stringify({ orderId: order.id, plate: order.vehicle.plate,
      customerSignature: true, signedAt, summary: supplemental ? '客户已补充签名，请核对并确认。工单按当前进度继续处理。' : '客户已完成签字，请核对签名并确认。确认前不会同步润丰或派工。', supplemental })]);
}

export async function validateSignatureReviewRecipient(row, user, database = pool) {
  if (!user?.active || !hasAnyRole(user, ['advisor', 'manager'])) return false;
  const { rows } = await database.query(`select 1 from work_orders where id=$1 and shop_id=$2
    and customer_signature_review->>'state'='pending'
    and ($5::text is null or customer_signature_review->>'signedAt'=$5) and ($3='manager' or advisor=(select name from users where id=$4))`,
    [row.order_id, user.shopId, hasRole(user, 'manager') ? 'manager' : 'advisor', user.id, row.payload?.signedAt || null]);
  return rows.length > 0;
}
