import { hasAnyRole } from "../../shared/roles.mjs";
import {individualRepair} from '../domain/individualRepair.mjs';
import { getDispatchTask } from './dispatchRepository.mjs';
import { technicianIds } from '../domain/dispatchPolicy.mjs';
import { HttpError } from '../http/HttpError.mjs';

export async function removeRepairPhoto(client, actor, orderId, fileId) {
  const task = await getDispatchTask(client, orderId, actor, true);
  const { rows: users } = await client.query('select role,active,shop_id from users where id=$1', [actor.id]);
  const owner = (hasAnyRole(actor, ['technician','outsourcing']) || actor.outsourcingRoleMember) && technicianIds(task).includes(actor.id)
    || task.executionMode === 'outsourced' && hasAnyRole(actor, ['manager','advisor']);
  if (!users[0]?.active || users[0].role !== actor.role || users[0].shop_id !== task.shopId || !owner || task.needsReview)
    throw new HttpError(403, '仅当前维修工可删除维修照片');
  if (!['待开工','维修中','暂停','回审'].includes(task.stage)) throw new HttpError(409, '当前状态不能删除维修照片');
  if(individualRepair(task)&&task.items.filter(i=>i.responsibleId===actor.id).every(i=>['待检验','已完工'].includes(i.status)))throw new HttpError(409,'本人项目已提交，不能删除维修照片');
  const { rows } = await client.query(`delete from files where id=$1 and order_id=$2
    and kind='repair_progress_photo' and coalesce(repair_round,0)=$3 and ($4::text is null or uploaded_by=$4) returning id`, [fileId, orderId, task.repairRound || 0,individualRepair(task)?actor.id:null]);
  if (!rows[0]) throw new HttpError(409, '照片不存在或属于历史维修轮次，请刷新后重试');
  await client.query('insert into audit_logs(order_id,actor,action) values($1,$2,$3)', [orderId, actor.name, `删除维修照片（文件 ${fileId}）`]);
  return { id: fileId };
}
