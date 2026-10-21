import { randomUUID } from 'node:crypto';
import { pool } from '../database/pool.mjs';

export async function queueCustomerSignatureReview(client, order) {
  const signedAt = new Date().toISOString();
  await client.query(`update work_orders set customer_signature_review=$2::jsonb where id=$1`,
    [order.id, JSON.stringify({ state: 'pending', signedAt })]);
  const { rows } = await client.query(`select id from users where active and shop_id=$1
    and (role='manager' or (role='advisor' and name=$2))`, [order.shop.id, order.advisor]);
  for (const user of rows) await client.query(`insert into dispatch_notifications(id,order_id,recipient_id,kind,payload)
    values($1,$2,$3,'需确认用户签字',$4::jsonb) on conflict do nothing`,
    [randomUUID(), order.id, user.id, JSON.stringify({ orderId: order.id, plate: order.vehicle.plate,
      customerSignature: true, signedAt, summary: '客户已完成签字，请核对签名并确认。确认前不会同步润丰或派工。' })]);
}

export async function validateSignatureReviewRecipient(row, user, database = pool) {
  if (!user?.active || !['advisor', 'manager'].includes(user.role)) return false;
  const { rows } = await database.query(`select 1 from work_orders where id=$1 and shop_id=$2
    and customer_signature_review->>'state'='pending'
    and ($5::text is null or customer_signature_review->>'signedAt'=$5) and ($3='manager' or advisor=(select name from users where id=$4))`,
    [row.order_id, user.shopId, user.role, user.id, row.payload?.signedAt || null]);
  return rows.length > 0;
}
