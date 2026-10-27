import { pool } from '../database/pool.mjs';
import { findWorkOrderById } from '../db.mjs';
import { dispatchDetail } from './dispatchRepository.mjs';
import { requireAnyRole } from '../domain/accessPolicy.mjs';
import { HttpError } from '../http/HttpError.mjs';

export async function readOrderOverview(id, user, database = pool) {
  requireAnyRole(user, ['advisor', 'manager']);
  const { rows } = await database.query('select shop_id from work_orders where id=$1', [id]);
  if (!rows.length) throw new HttpError(404, '委托单不存在');
  if (!user.shopId || rows[0].shop_id !== user.shopId) throw new HttpError(403, '无权查看其他门店工单');
  const order = await findWorkOrderById(database, id);
  // This read-only view never exposes a customer signing capability.
  delete order.signatureToken;
  delete order.signatureTokenUsed;
  return { order, dispatch: await dispatchDetail(user, id, database) };
}
