import type {DispatchTask} from '../../../../shared/types';
import type {DispatchController} from './useDispatchController';
export {isIndividualRepair as individualRepair} from '../../../../shared/repairProgress.mjs';
import {isIndividualRepair as individualRepair,personalWorkOffer,personalFeedback,isReworkTask} from '../../../../shared/repairProgress.mjs';
export function personalTask(task:DispatchTask,ownerId:string):DispatchTask {
 if(!individualRepair(task))return task;
 const items=task.items.filter(i=>i.responsibleId===ownerId);
 const returned=items.filter(i=>i.status!=='已完工'&&(i.rejectionReason||task.rejectedItemIds?.includes(i.id)));
 const reworkReason=[...new Set(returned.map(i=>i.rejectionReason).filter(Boolean))].join('；');
 const legacyRework=!task.items.some(i=>i.rejectionReason)&&!task.rejectedItemIds?.length;
 return {...task,...(personalWorkOffer(task,ownerId)&&task.stage!=='暂停'?{stage:'待接单' as const}:{}),...(task.workerPauses?.[ownerId]?{stage:'暂停' as const,...task.workerPauses[ownerId]}:{}),feedback:personalFeedback(task,ownerId),items,partsRequirement:task.partsRequests?.find(p=>p.ownerId===ownerId),rework:isReworkTask(task,ownerId),rejectedItemIds:returned.map(i=>i.id),reworkReason:reworkReason||((returned.length||legacyRework)?task.reworkReason:undefined)};
}
export function partsController(c:DispatchController,ownerId?:string):DispatchController {
 if(!c.detail)return c;
 const task=c.detail.task;
 return {...c,detail:{...c.detail,task:{...task,partsRequirement:ownerId?task.partsRequests?.find(p=>p.ownerId===ownerId):task.partsRequirement}},act:input=>c.act({...input,...(ownerId?{partsOwnerId:ownerId}:{})})};
}
export { warehouseRequests } from '../../../../shared/warehouseRequests.mjs';
