import {hasRole,hasAnyRole} from '../../shared/roles.mjs';
import {hasPendingInspection,personalRepairStage,isReworkTask} from '../../shared/repairProgress.mjs';
import {pendingPhotoWaivers} from '../../shared/repairPhotoWaiver.mjs';
import {canReceiveInspectionNotification} from './inspectionNotificationAudience.mjs';
import {technicianIds} from './dispatchPolicy.mjs';

export function personalOrderTodos(task,user,review,pending=[]) {
 if(!user.active||task.shopId!==user.shopId)return [];
 const categories=new Set();
 const owner=task.advisor===user.name&&hasAnyRole(user,['manager','advisor']);
 if(owner) {
  if(review?.state==='pending')categories.add('签字待确认');
  else if(task.stage==='待客户签字')categories.add('待客户签字');
  if(task.stage==='待派工')categories.add('待派工');
  if(task.stage==='待接单'&&task.feedback)categories.add('无法接单待处理');
 }
 if(hasAnyRole(user,['manager','advisor'])&&pendingPhotoWaivers(task).some(e=>e.applicantId!==user.id))categories.add('无照片待审批');
 if(hasAnyRole(user,['technician','outsourcing'])&&technicianIds(task).includes(user.id)) {
  const stage=personalRepairStage(task,user.id);
  if(!(stage==='待接单'&&task.feedback)&&['待接单','待开工','维修中','回审','暂停'].includes(stage))categories.add(isReworkTask(task,user.id)?'返修待处理':stage);
  const parts=[task.partsRequirement,...(task.partsRequests||[])].filter(Boolean);
  if(['待接单','待开工','维修中','回审','暂停'].includes(stage)&&parts.some(p=>p.mode!=='none'&&(p.ownerId===user.id||p.items?.some(i=>i.recipientId===user.id))&&!p.issuedAt&&(p.preparedAt||p.items?.some(i=>i.recipientId===user.id&&i.preparedAt&&!i.issuedAt))))categories.add('配件可领取');
 }
 if(hasPendingInspection(task)&&(!task.inspectorId||task.inspectorId===user.id)&&canReceiveInspectionNotification(task,user))categories.add('待检验');
 if(canReceiveInspectionNotification(task,user)&&pending.some(p=>p.sourceInspectorId===user.id&&p.inspectionState==='pending'))categories.add('待定项目待处理');
 if(hasRole(user,'warehouse')&&!['维修完成','草稿','待客户签字'].includes(task.stage)&&[task.partsRequirement,...(task.partsRequests||[])].some(p=>p&&p.mode!=='none'&&!p.preparedAt&&!p.issuedAt))categories.add('配件待备齐');
 return [...categories].map(category=>({id:`order:${task.orderId}:${category}`,category,title:task.plate||task.dispatchNo||'维修委托',summary:task.items.map(i=>i.name).join('、').slice(0,180),targetKey:['签字待确认','待客户签字'].includes(category)?'workOrder':'dispatchOrder',targetId:task.orderId}));
}
