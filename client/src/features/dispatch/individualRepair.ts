import type {DispatchTask} from '../../../../shared/types';
import type {DispatchController} from './useDispatchController';
export {isIndividualRepair as individualRepair} from '../../../../shared/repairProgress.mjs';
import {isIndividualRepair as individualRepair} from '../../../../shared/repairProgress.mjs';
export function personalTask(task:DispatchTask,ownerId:string):DispatchTask {
 if(!individualRepair(task))return task;
 return {...task,...(task.workerPauses?.[ownerId]?{stage:'暂停' as const,...task.workerPauses[ownerId]}:{}),items:task.items.filter(i=>i.responsibleId===ownerId),partsRequirement:task.partsRequests?.find(p=>p.ownerId===ownerId)};
}
export function partsController(c:DispatchController,ownerId?:string):DispatchController {
 if(!c.detail)return c;
 const task=c.detail.task;
 return {...c,detail:{...c.detail,task:{...task,partsRequirement:ownerId?task.partsRequests?.find(p=>p.ownerId===ownerId):task.partsRequirement}},act:input=>c.act({...input,...(ownerId?{partsOwnerId:ownerId}:{})})};
}
export function warehouseRequests(tasks:DispatchTask[]):DispatchTask[] {
 return tasks.flatMap(task=>[...(task.partsRequirement?[task]:[]),...(task.partsRequests||[]).map(parts=>({...task,partsRequirement:parts}))]);
}
