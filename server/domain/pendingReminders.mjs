import {pendingPhotoWaivers} from '../../shared/repairPhotoWaiver.mjs';
import {hasAnyRole,hasRole} from '../../shared/roles.mjs';
import {canReceiveInspectionNotification} from './inspectionNotificationAudience.mjs';
// All clocks are Shanghai local business hours, every day 08:00–18:00.
const day=86400000,offset=8*3600000;
export function nextBusinessTime(value){let t=new Date(value).getTime()+offset;const d=Math.floor(t/day)*day;return new Date((t<d+8*3600000?d+8*3600000:t>=d+18*3600000?d+day+8*3600000:t)-offset);}
export function addBusinessMinutes(value,minutes){let t=nextBusinessTime(value).getTime()+offset,left=minutes*60000;while(left>0){const end=Math.floor(t/day)*day+18*3600000,span=end-t;if(left<span){t+=left;left=0;}else{left-=span;t=Math.floor(t/day)*day+day+8*3600000;}}return new Date(t-offset);}
export function isBusinessTime(value=new Date()){return nextBusinessTime(value).getTime()===new Date(value).getTime();}
export function nextBusinessMorning(value){const t=new Date(value).getTime()+offset;return new Date(Math.floor(t/day)*day+day+8*3600000-offset);}
export function businessMinutesBetween(start,end=new Date()){
 const a=new Date(start).getTime()+offset,b=new Date(end).getTime()+offset;if(b<=a)return 0;
 const first=Math.floor(a/day),last=Math.floor(b/day),portion=t=>Math.max(0,Math.min(10*3600000,t%day-8*3600000));
 return Math.max(0,((last-first)*10*3600000+portion(b)-portion(a))/60000);
}
export const reminderMinutes={'待客户签字':120,'签字待确认':120,'待派工':60,'待检验':60,'无照片待审批':60,'用车待审批':60,'委托书待同步':30};
export function pendingSnapshotSlots(snapshot){
 const {task,order,trip}=snapshot;
 if(trip)return trip.status==='待审批'?[{key:'trip',kind:'用车待审批',targetKey:'vehicleTrip',title:trip.vehicle_snapshot?.plate||'出车申请'}]:[];
 if(!order||!task||order.status==='待处理纸质委托书')return [];
 const slots=[],add=(key,kind,extra={})=>slots.push({key,kind,targetKey:['待客户签字','签字待确认','委托书待同步'].includes(kind)?'workOrder':'dispatchOrder',title:task.plate||task.dispatchNo||'维修委托',...extra});
 if(order.customer_signature_review?.state==='pending')add('signature-review','签字待确认');
 else if(task.stage==='待客户签字')add('signature','待客户签字');
 if(task.stage==='待派工'&&!['草稿','待客户签字','完成','待结算'].includes(order.status))add('dispatch','待派工');
 if(task.executionMode!=='outsourced')for(const item of task.items||[])if(item.status==='待检验')add(`inspection:${task.repairRound||0}:${item.id}:${item.finishAt||''}`,'待检验',{itemId:item.id});
 for(const waiver of pendingPhotoWaivers(task))add(`waiver:${waiver.id}`,'无照片待审批',{applicantId:waiver.applicantId});
 if(order.paper_order?.mode==='dingtalk'&&!['草稿','待处理纸质委托书'].includes(order.status)&&['pending','processing','failed'].includes(order.legacy_sync_status))add('paper-sync','委托书待同步',{failed:order.legacy_sync_status==='failed',error:order.legacy_sync_error||''});
 return slots;
}
export function reminderRecipient(slot,snapshot,user,level=0){
 const shop=snapshot.order?.shop_id||snapshot.trip?.shop_id;
 if(!user?.active||user.shopId!==shop)return false;
 const manager=hasRole(user,'manager');
 if(slot.kind==='用车待审批')return manager&&snapshot.trip.applicant_id!==user.id;
 if(slot.kind==='无照片待审批')return user.id!==slot.applicantId&&hasAnyRole(user,['manager','advisor']);
 if(level>0&&manager)return true;
 if(slot.kind==='待检验')return (!snapshot.task.inspectorId||snapshot.task.inspectorId===user.id)&&canReceiveInspectionNotification(snapshot.task,user);
 return hasAnyRole(user,['advisor','manager'])&&user.name===snapshot.task.advisor;
}
