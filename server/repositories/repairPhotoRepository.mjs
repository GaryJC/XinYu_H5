import { getDispatchTask } from './dispatchRepository.mjs';
import { technicianIds } from '../domain/dispatchPolicy.mjs';
import { HttpError } from '../http/HttpError.mjs';

export async function removeRepairPhoto(client, actor, orderId, fileId) {
  const task = await getDispatchTask(client, orderId, actor, true);
  const { rows: users } = await client.query('select role,active,shop_id from users where id=$1', [actor.id]);
  const owner = (['technician','outsourcing'].includes(actor.role) || actor.outsourcingRoleMember) && technicianIds(task).includes(actor.id)
    || task.executionMode === 'outsourced' && ['manager','advisor'].includes(actor.role);
  if (!users[0]?.active || users[0].role !== actor.role || users[0].shop_id !== task.shopId || !owner || task.needsReview)
    throw new HttpError(403, '仅当前维修工可删除维修照片');
  if (!['待开工','维修中','暂停'].includes(task.stage)) throw new HttpError(409, '当前状态不能删除维修照片');
  const { rows } = await client.query(`delete from files where id=$1 and order_id=$2
    and kind='repair_progress_photo' and coalesce(repair_round,0)=$3 returning id`, [fileId, orderId, task.repairRound || 0]);
  if (!rows[0]) throw new HttpError(409, '照片不存在或属于历史维修轮次，请刷新后重试');
  await client.query('insert into audit_logs(order_id,actor,action) values($1,$2,$3)', [orderId, actor.name, `删除维修照片（文件 ${fileId}）`]);
  return { id: fileId };
}
