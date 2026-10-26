import { hasAnyRole } from "../../shared/roles.mjs";
import {HttpError} from '../http/HttpError.mjs';
export function validatePartsIssue(input) {
 if(input.preparationGroups!==undefined){
  const groups=input.preparationGroups;
  if(input.action!=='confirm-parts'||input.partsOwnerId!==undefined||input.partsPreparation!==undefined||input.partsIssue!==undefined||!Array.isArray(groups)||!groups.length||groups.length>100)
   throw new HttpError(400,'批量备料参数无效');
  const owners=new Set();
  for(const group of groups){
   if(!group||group.partsOwnerId!==undefined&&(typeof group.partsOwnerId!=='string'||!group.partsOwnerId||group.partsOwnerId.length>200)||owners.has(group.partsOwnerId||''))throw new HttpError(400,'备料申请重复或无效');
   owners.add(group.partsOwnerId||'');
   validatePartsIssue({action:'confirm-parts',partsPreparation:group.items});
   if(group.items===undefined)throw new HttpError(400,'请选择本次备齐配件');
  }
 }
 if(input.partsPreparation!==undefined){
  if(input.action!=='confirm-parts')throw new HttpError(400,'请通过备料完成入口提交');
  try {validatePartsIssue({...input,action:'issue-parts',partsIssue:input.partsPreparation,partsPreparation:undefined});}
  catch {throw new HttpError(400,'请选择本次备齐配件，并为每项指定领料人');}
 }
 if(input.partsIssue===undefined)return;
 const rows=input.partsIssue;
 if(input.action!=='issue-parts'||!Array.isArray(rows)||!rows.length||rows.length>100||rows.some(r=>!r||!Number.isInteger(r.index)||r.index<0||typeof r.recipientId!=='string'||!r.recipientId||r.recipientId.length>200)||new Set(rows.map(r=>r.index)).size!==rows.length)
  throw new HttpError(400,'请选择本次出库配件，并为每项指定领料人');
}
export function issueParts(task,input,actor,people,now,recipientScope) {
 const parts=task.partsRequirement,ids=recipientScope??task.technicianIds??(task.technicianId?[task.technicianId]:[]);
 // Legacy single-person callers can still issue the prepared batch in one operation.
 if(!input.partsIssue) {
  if(!parts.preparedAt)throw new HttpError(409,'请先确认备料完成');
  if(ids.length>1&&!parts.ownerId)throw new HttpError(400,'多人维修请逐项确认配件领料人');
  if(parts.mode==='photo')return {...parts,issuedBy:actor.id,issuedName:actor.name,issuedAt:now,recipientIds:parts.ownerId?[parts.ownerId]:ids,recipientName:parts.ownerName||task.technicianName||parts.recordedName};
 }
 if(parts.mode!=='list')throw new HttpError(409,'请先将手写清单整理为配件明细，再逐项出库');
 const selected=input.partsIssue??parts.items.flatMap((item,index)=>item.issuedAt?[]:[{index,recipientId:item.recipientId||parts.ownerId||ids[0]}]);
 if(!selected.length)throw new HttpError(409,'没有待出库配件');
 const items=parts.items.map(item=>({...item}));
 for(const row of selected) {
  const item=items[row.index];
  if(!item)throw new HttpError(409,'配件清单已变化，请刷新');
  if(item.issuedAt)throw new HttpError(409,'所选配件已出库，请勿重复操作');
  const person=people.find(p=>p.id===row.recipientId&&p.active&&p.shopId===task.shopId&&ids.includes(p.id)&&(hasAnyRole(p, ['technician','outsourcing'])||p.outsourcingRoleMember));
  if(!person)throw new HttpError(400,'领料人必须是本单有效维修工');
  Object.assign(item,{recipientId:person.id,recipientName:person.name,issuedAt:now,issuedBy:actor.id,issuedName:actor.name});
 }
 const issued=items.filter(item=>item.issuedAt),recipientIds=[...new Set(issued.map(item=>item.recipientId))];
 return {...parts,items,recipientIds,recipientName:recipientIds.map(id=>issued.find(i=>i.recipientId===id).recipientName).join('、'),...(issued.length===items.length?{issuedAt:now,issuedBy:actor.id,issuedName:actor.name}:{})};
}

export function prepareParts(task,input,actor,people,now,recipientScope) {
 const parts=task.partsRequirement,ids=recipientScope??task.technicianIds??(task.technicianId?[task.technicianId]:[]);
 if(parts.mode!=='list')throw new HttpError(409,'请先将手写清单整理为配件明细，再逐项备料');
 const items=parts.items.map(item=>({...item}));
 for(const row of input.partsPreparation) {
  const item=items[row.index];
  if(!item)throw new HttpError(409,'配件清单已变化，请刷新');
  if(item.preparedAt||item.issuedAt)throw new HttpError(409,'所选配件已备齐，请勿重复操作');
  const person=people.find(p=>p.id===row.recipientId&&p.active&&p.shopId===task.shopId&&ids.includes(p.id)&&(hasAnyRole(p, ['technician','outsourcing'])||p.outsourcingRoleMember));
  if(!person)throw new HttpError(400,'领料人必须是本单有效维修工');
  Object.assign(item,{recipientId:person.id,recipientName:person.name,preparedAt:now,preparedBy:actor.id,preparedName:actor.name});
 }
 const prepared=items.filter(item=>item.preparedAt||item.issuedAt),recipientIds=[...new Set(prepared.map(item=>item.recipientId).filter(Boolean))];
 return {...parts,items,preparationOnly:true,recipientIds,recipientName:recipientIds.map(id=>prepared.find(i=>i.recipientId===id).recipientName).join('、'),...(prepared.length===items.length?{preparedAt:now,preparedBy:actor.id,preparedName:actor.name}:{})};
}
