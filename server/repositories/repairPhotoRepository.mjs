import { hasAnyRole } from "../../shared/roles.mjs";
import {individualRepair,hasSubmittedPersonalWork} from '../domain/individualRepair.mjs';
import { getDispatchTask } from './dispatchRepository.mjs';
import { technicianIds } from '../domain/dispatchPolicy.mjs';
import { HttpError } from '../http/HttpError.mjs';

export async function removeRepairPhoto(client, actor, orderId, fileId) {
  await removeRepairPhotos(client, actor, orderId, [fileId]);
  return { id: fileId };
}

export async function removeRepairPhotos(client, actor, orderId, fileIds) {
  if (!Array.isArray(fileIds) || !fileIds.length || fileIds.length > 100
    || fileIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 200) || new Set(fileIds).size !== fileIds.length)
    throw new HttpError(400, '请选择要删除的维修照片（每次最多 100 张）');
  const task = await getDispatchTask(client, orderId, actor, true);
  const { rows: users } = await client.query('select role,active,shop_id from users where id=$1', [actor.id]);
  const owner = (hasAnyRole(actor, ['technician','outsourcing']) || actor.outsourcingRoleMember) && technicianIds(task).includes(actor.id)
    || task.executionMode === 'outsourced' && hasAnyRole(actor, ['manager','advisor']);
  if (!users[0]?.active || users[0].role !== actor.role || users[0].shop_id !== task.shopId || !owner || task.needsReview)
    throw new HttpError(403, '仅当前维修工可删除维修照片');
  if (!['待开工','维修中','暂停','回审'].includes(task.stage)) throw new HttpError(409, '当前状态不能删除维修照片');
  if(hasSubmittedPersonalWork(task,actor.id))throw new HttpError(409,'本人项目已提交，不能删除维修照片');
  const params = [fileIds, orderId, task.repairRound || 0, individualRepair(task) ? actor.id : null];
  const condition = "id=any($1::text[]) and order_id=$2 and kind='repair_progress_photo' and coalesce(repair_round,0)=$3 and ($4::text is null or uploaded_by=$4)";
  const { rows: selected } = await client.query(`select id from files where ${condition} for update`, params);
  if (selected.length !== fileIds.length) throw new HttpError(409, '所选照片不存在、属于历史维修轮次或无权删除，请刷新后重试');
  const { rows } = await client.query(`delete from files where ${condition} returning id`, params);
  if (rows.length !== fileIds.length) throw new HttpError(409, '照片已变化，请刷新后重试');
  await client.query('insert into audit_logs(order_id,actor,action) values($1,$2,$3)', [orderId, actor.name, `删除维修照片（文件 ${fileIds.join('、')}）`]);
  return { ids: fileIds };
}
