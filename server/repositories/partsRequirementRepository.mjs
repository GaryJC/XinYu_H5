import { HttpError } from '../http/HttpError.mjs';
export async function assertPartsPhotos(client,task,requirement) {
  if(requirement?.mode!=='photo') return;
  const {rows}=await client.query("select id from files where id=any($1::text[]) and order_id=$2 and repair_round=$3 and kind='repair_parts_photo'",[requirement.photoIds,task.orderId,task.repairRound||0]);
  if(rows.length!==requirement.photoIds.length) throw new HttpError(400,'配件照片必须是本单当前维修轮次已上传的手写清单');
}

// Recheck the current batch before sending a delayed pickup notice.
export async function validatePartsPickupNotification(row,user,database) {
  if(!user?.active || user.shopId!==row.payload.shopId) return false;
  const {rows}=await database.query('select stage,data,technician_id from dispatch_tasks where order_id=$1',[row.order_id]);
  const task=rows[0],data=task?.data,parts=row.payload.partsOwnerId?data?.partsRequests?.find(p=>p.ownerId===row.payload.partsOwnerId):data?.partsRequirement;
  if(row.kind==='配件可领取'&&row.payload.preparationGroups){
    if(!task||user.id!==row.recipient_id||!(['technician','outsourcing'].includes(user.role)||user.outsourcingRoleMember)||!(data.technicianIds??[task.technician_id]).includes(row.recipient_id)||(data.repairRound||0)!==(row.payload.repairRound||0))return false;
    return row.payload.preparationGroups.length>0&&row.payload.preparationGroups.every(group=>{
      const requirement=group.partsOwnerId?data.partsRequests?.find(p=>p.ownerId===group.partsOwnerId):data.partsRequirement;
      return requirement&&requirement.recordedAt===group.partsRecordedAt&&requirement.revision===group.partsRevision&&group.items.length>0&&group.items.every(selected=>{
        const item=requirement.items?.[selected.index];
        return item?.preparedAt===selected.preparedAt&&item.recipientId===row.recipient_id;
      });
    });
  }
  if(row.kind==='配件可领取'&&row.payload.partsPreparation){
    if(!parts||parts.recordedAt!==row.payload.partsRecordedAt||parts.revision!==row.payload.partsRevision||(data.repairRound||0)!==(row.payload.repairRound||0))return false;
    return (['technician','outsourcing'].includes(user.role)||user.outsourcingRoleMember)&&row.payload.partsPreparation.length>0&&row.payload.partsPreparation.every(r=>{const item=parts.items?.[r.index];return item?.preparedAt===r.preparedAt&&item.recipientId===row.recipient_id;})&&(data.technicianIds??[task.technician_id]).includes(row.recipient_id);
  }
  if(row.kind==='配件已出库'){if(parts?.recipientIds&&!parts.recipientIds.includes(row.recipient_id))return false;}
  else if(parts?.ownerId&&parts.ownerId!==row.recipient_id)return false;
  if(!task || !['待开工','维修中','暂停'].includes(task.stage) || (data.repairRound||0)!==(row.payload.repairRound||0) || !parts || parts.recordedAt!==row.payload.partsRecordedAt || parts.revision!==row.payload.partsRevision) return false;
  const handler=(['technician','outsourcing'].includes(user.role)||user.outsourcingRoleMember)&&(data.technicianIds??[task.technician_id]).includes(row.recipient_id)||data.executionMode==='outsourced'&&['manager','advisor'].includes(user.role);
  if(!handler) return false;
  if(row.kind==='配件需求已调整')return true;
  return row.kind==='配件可领取'?Boolean(parts.preparedAt&&!parts.issuedAt):Boolean(parts.issuedAt||parts.items?.some(item=>item.issuedAt&&item.recipientId===row.recipient_id));
}
