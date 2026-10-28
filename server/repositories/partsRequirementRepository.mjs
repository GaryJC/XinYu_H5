import { hasRole, hasAnyRole } from "../../shared/roles.mjs";
import { HttpError } from '../http/HttpError.mjs';
export async function assertPartsPhotos(client,task,requirement,referenceOwnerId) {
  if(requirement?.referencePhotoIds?.length){
    const previous=requirement.ownerId?task.partsRequests?.find(parts=>parts.ownerId===requirement.ownerId):task.partsRequirement;
    const {rows}=await client.query("select id from files where id=any($1::text[]) and order_id=$2 and repair_round=$3 and kind='repair_parts_photo' and ($4::text is null or uploaded_by=$4 or id=any($5::text[]))",[requirement.referencePhotoIds,task.orderId,task.repairRound||0,referenceOwnerId||null,previous?.referencePhotoIds||[]]);
    if(rows.length!==requirement.referencePhotoIds.length)throw new HttpError(400,'配件照片必须是本人在本单当前维修轮次上传的照片');
  }
  if(requirement?.mode!=='photo') return;
  const {rows}=await client.query("select id from files where id=any($1::text[]) and order_id=$2 and repair_round=$3 and kind='repair_parts_photo'",[requirement.photoIds,task.orderId,task.repairRound||0]);
  if(rows.length!==requirement.photoIds.length) throw new HttpError(400,'配件照片必须是本单当前维修轮次已上传的手写清单');
}

// Recheck the current batch before sending a delayed pickup notice.
export async function validatePartsPickupNotification(row,user,database) {
  if(!user?.active || user.shopId!==row.payload.shopId) return false;
  const {rows}=await database.query('select stage,data,technician_id from dispatch_tasks where order_id=$1',[row.order_id]);
  const task=rows[0],data=task?.data,parts=row.payload.partsOwnerId?data?.partsRequests?.find(p=>p.ownerId===row.payload.partsOwnerId):data?.partsRequirement;
  if(!task||!data||!['待开工','维修中','暂停','回审'].includes(task.stage))return false;
  if(['配件申请','配件申请已更新'].includes(row.kind)) {
    if(user.id!==row.recipient_id||!hasRole(user,'warehouse')||!parts
      ||(data.repairRound||0)!==(row.payload.repairRound||0)
      ||parts.recordedAt!==row.payload.partsRecordedAt||parts.revision!==row.payload.partsRevision)return false;
    return row.kind==='配件申请已更新'||parts.mode!=='none'&&!parts.preparedAt&&!parts.issuedAt;
  }
  if(row.kind==='配件可领取'&&row.payload.preparationGroups){
    if(!task||user.id!==row.recipient_id||!(hasAnyRole(user, ['technician','outsourcing'])||user.outsourcingRoleMember)||!(data.technicianIds??[task.technician_id]).includes(row.recipient_id)||(data.repairRound||0)!==(row.payload.repairRound||0))return false;
    return row.payload.preparationGroups.length>0&&row.payload.preparationGroups.every(group=>{
      const requirement=group.partsOwnerId?data.partsRequests?.find(p=>p.ownerId===group.partsOwnerId):data.partsRequirement;
      return requirement&&!requirement.issuedAt&&requirement.recordedAt===group.partsRecordedAt&&requirement.revision===group.partsRevision&&group.items.length>0&&group.items.every(selected=>{
        const item=requirement.items?.[selected.index];
        return !item?.issuedAt&&item?.preparedAt===selected.preparedAt&&item.recipientId===row.recipient_id;
      });
    });
  }
  if(row.kind==='配件可领取'&&row.payload.partsPreparation){
    if(!parts||parts.issuedAt||parts.recordedAt!==row.payload.partsRecordedAt||parts.revision!==row.payload.partsRevision||(data.repairRound||0)!==(row.payload.repairRound||0))return false;
    return (hasAnyRole(user, ['technician','outsourcing'])||user.outsourcingRoleMember)&&row.payload.partsPreparation.length>0&&row.payload.partsPreparation.every(r=>{const item=parts.items?.[r.index];return !item?.issuedAt&&item?.preparedAt===r.preparedAt&&item.recipientId===row.recipient_id;})&&(data.technicianIds??[task.technician_id]).includes(row.recipient_id);
  }
  if(row.kind==='配件已出库'){if(parts?.recipientIds&&!parts.recipientIds.includes(row.recipient_id))return false;}
  else if(parts?.ownerId&&parts.ownerId!==row.recipient_id)return false;
  if(!task || !['待开工','维修中','暂停','回审'].includes(task.stage) || (data.repairRound||0)!==(row.payload.repairRound||0) || !parts || parts.recordedAt!==row.payload.partsRecordedAt || parts.revision!==row.payload.partsRevision) return false;
  const handler=(hasAnyRole(user, ['technician','outsourcing'])||user.outsourcingRoleMember)&&(data.technicianIds??[task.technician_id]).includes(row.recipient_id)||data.executionMode==='outsourced'&&hasAnyRole(user, ['manager','advisor']);
  if(!handler) return false;
  if(row.kind==='配件需求已调整')return true;
  return row.kind==='配件可领取'?Boolean(parts.preparedAt&&!parts.issuedAt):Boolean(parts.issuedAt||parts.items?.some(item=>item.issuedAt&&item.recipientId===row.recipient_id));
}

export async function assertVehicleNameplate(client,task,requirement) {
  if(!requirement||requirement.mode==='none')return;
  const {rows}=await client.query("select id from files where order_id=$1 and kind='vehicle_nameplate_photo' limit 1",[task.orderId]);
  if(!rows.length)throw new HttpError(400,'申请配件前请上传车辆铭牌照片，同一工单只需上传一次');
}
