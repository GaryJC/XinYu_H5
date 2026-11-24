import {warehouseRequests,matchesPartsStatus} from '../../shared/warehouseRequests.mjs';
import {hasRole,hasAnyRole} from '../../shared/roles.mjs';
import {isOrderAdvisor} from '../../shared/orderOwnership.mjs';
import {hasPendingInspection,personalRepairStage,isReworkTask,hasDeclinedWork,personalFeedback} from '../../shared/repairProgress.mjs';
import {pendingPhotoWaivers} from '../../shared/repairPhotoWaiver.mjs';
import {canReceiveInspectionNotification} from './inspectionNotificationAudience.mjs';
import {technicianIds} from './dispatchPolicy.mjs';

export function personalOrderTodos(task,user,review,pending=[]) {
 if(!user.active||task.shopId!==user.shopId)return [];
 const categories=new Set();
 const owner=hasAnyRole(user,['manager','advisor'])&&isOrderAdvisor(task.advisorUserId,task.advisor,user);
 if(owner) {
  if(review?.state==='pending')categories.add('签字待确认');
  else if(task.stage==='待客户签字')categories.add('待客户签字');
  if(task.stage==='待派工')categories.add('待派工');
  if(hasDeclinedWork(task))categories.add('无法接单待处理');
 }
 if(hasAnyRole(user,['manager','advisor'])&&pendingPhotoWaivers(task).some(e=>e.applicantId!==user.id))categories.add('无照片待审批');
 if(hasAnyRole(user,['technician','outsourcing'])&&technicianIds(task).includes(user.id)) {
  const stage=personalRepairStage(task,user.id);
  if(!personalFeedback(task,user.id)&&['待接单','待开工','维修中','回审','暂停'].includes(stage))categories.add(isReworkTask(task,user.id)?'返修待处理':stage);
  const parts=[task.partsRequirement,...(task.partsRequests||[])].filter(Boolean);
  if(['待接单','待开工','维修中','回审','暂停'].includes(stage)&&parts.some(p=>p.mode!=='none'&&(p.ownerId===user.id||p.items?.some(i=>i.recipientId===user.id))&&!p.issuedAt&&(p.preparedAt||p.items?.some(i=>i.recipientId===user.id&&i.preparedAt&&!i.issuedAt))))categories.add('配件可领取');
 }
 if(hasPendingInspection(task)&&(!task.inspectorId||task.inspectorId===user.id)&&canReceiveInspectionNotification(task,user))categories.add('待检验');
 if(canReceiveInspectionNotification(task,user)&&pending.some(p=>p.sourceInspectorId===user.id&&p.inspectionState==='pending'))categories.add('待定项目待处理');
 const partsTodos=hasRole(user,'warehouse')?warehouseRequests([task]).filter(request=>matchesPartsStatus(request,'待备料')||matchesPartsStatus(request,'部分备齐')).map(request=>{
  const parts=request.partsRequirement;
  const partsOwnerId=parts.ownerId||'';
  return {id:`order:${task.orderId}:parts:${partsOwnerId}`,category:'配件待备齐',title:task.plate||task.dispatchNo||'维修委托',summary:`申请人：${parts.ownerName||parts.applicantName||parts.recordedName||task.technicianName||'未记录'}`,targetKey:'dispatchOrder',targetId:task.orderId,partsOwnerId};
 }):[];
 return [...partsTodos,...[...categories].map(category=>({id:`order:${task.orderId}:${category}`,category,title:task.plate||task.dispatchNo||'维修委托',summary:task.items.map(i=>i.name).join('、').slice(0,180),targetKey:['签字待确认','待客户签字'].includes(category)?'workOrder':'dispatchOrder',targetId:task.orderId}))];
}
