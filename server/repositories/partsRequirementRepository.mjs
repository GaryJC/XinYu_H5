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

// Keep the Boolean validation API for callers that do not deliver notifications.
export async function validatePartsPickupNotification(row,user,database) {
  return Boolean(await currentPartsNotification(row,user,database));
}

const pickupSummary=items=>items.map(item=>`${item.name} ${item.quantity}${item.unit}`).join('、').slice(0,200);
const withPickupItems=(row,items,scope={})=>items.length?{...row,payload:{...row.payload,...scope,summary:pickupSummary(items)}}:undefined;

// Resolve the message immediately before delivery. A partial handover only
// removes its own lines; it must not cancel the remaining pickup reminder.
export async function currentPartsNotification(row,user,database) {
  if(!user?.active || user.shopId!==row.payload.shopId) return false;
  const {rows}=await database.query('select stage,data,technician_id from dispatch_tasks where order_id=$1',[row.order_id]);
  const task=rows[0],data=task?.data,parts=row.payload.partsOwnerId?data?.partsRequests?.find(p=>p.ownerId===row.payload.partsOwnerId):data?.partsRequirement;
  if(!task||!data||!['待开工','维修中','暂停','回审'].includes(task.stage))return false;
  if(['配件申请','配件申请已更新'].includes(row.kind)) {
    if(user.id!==row.recipient_id||!hasRole(user,'warehouse')||!parts
      ||(data.repairRound||0)!==(row.payload.repairRound||0)
      ||parts.recordedAt!==row.payload.partsRecordedAt||parts.revision!==row.payload.partsRevision)return false;
    return row.kind==='配件申请已更新'||parts.mode!=='none'&&!parts.preparedAt&&!parts.issuedAt?row:undefined;
  }
  const handler=user.id===row.recipient_id&&(data.executionMode==='outsourced'
    ? user.id===data.assignedBy&&hasAnyRole(user,['manager','advisor','inspector'])
    : hasAnyRole(user,['technician'])&&(data.technicianIds??[task.technician_id]).includes(user.id));
  if(!handler)return false;
  if(row.kind==='配件可领取'&&row.payload.preparationGroups){
    if(!task||(data.repairRound||0)!==(row.payload.repairRound||0))return false;
    const selectedItems=[];
    const preparationGroups=row.payload.preparationGroups.flatMap(group=>{
      const requirement=group.partsOwnerId?data.partsRequests?.find(p=>p.ownerId===group.partsOwnerId):data.partsRequirement;
      if(!requirement||requirement.issuedAt||requirement.recordedAt!==group.partsRecordedAt||requirement.revision!==group.partsRevision)return [];
      const items=group.items.filter(selected=>{
        const item=requirement.items?.[selected.index];
        if(!item||item.issuedAt||item.preparedAt!==selected.preparedAt||item.recipientId!==row.recipient_id)return false;
        selectedItems.push(item);return true;
      });
      return items.length?[{...group,items}]:[];
    });
    return withPickupItems(row,selectedItems,{preparationGroups});
  }
  if(row.kind==='配件可领取'&&row.payload.partsPreparation){
    if(!parts||parts.issuedAt||parts.recordedAt!==row.payload.partsRecordedAt||parts.revision!==row.payload.partsRevision||(data.repairRound||0)!==(row.payload.repairRound||0))return false;
    const partsPreparation=row.payload.partsPreparation.filter(r=>{const item=parts.items?.[r.index];return item&&!item.issuedAt&&item.preparedAt===r.preparedAt&&item.recipientId===row.recipient_id;});
    return withPickupItems(row,partsPreparation.map(r=>parts.items[r.index]),{partsPreparation});
  }
  if(row.kind==='配件已出库'){if(parts?.recipientIds&&!parts.recipientIds.includes(row.recipient_id))return false;}
  else if(data.executionMode!=='outsourced'&&parts?.ownerId&&parts.ownerId!==row.recipient_id)return false;
  if(!task || !['待开工','维修中','暂停','回审'].includes(task.stage) || (data.repairRound||0)!==(row.payload.repairRound||0) || !parts || parts.recordedAt!==row.payload.partsRecordedAt || parts.revision!==row.payload.partsRevision) return false;
  if(row.kind==='配件需求已调整')return row;
  if(row.kind==='配件可领取') {
    if(!parts.preparedAt||parts.issuedAt)return false;
    // Older whole-batch notices have no selected indices. Their original scope
    // is the unchanged batch; keep photo-only and unallocated legacy requests.
    if(parts.mode==='list'&&parts.items?.length)return withPickupItems(row,parts.items.filter(item=>!item.issuedAt&&(!item.recipientId||item.recipientId===row.recipient_id)));
    return row;
  }
  return parts.issuedAt||parts.items?.some(item=>item.issuedAt&&item.recipientId===row.recipient_id)?row:undefined;
}

export async function assertVehicleNameplate(client,task,requirement) {
  if(!requirement||requirement.mode==='none')return;
  const {rows}=await client.query("select id from files where order_id=$1 and kind='vehicle_nameplate_photo' limit 1",[task.orderId]);
  if(!rows.length)throw new HttpError(400,'申请配件前请上传车辆铭牌照片，同一工单只需上传一次');
}
