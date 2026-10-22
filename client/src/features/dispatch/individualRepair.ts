import type {DispatchTask} from '../../../../shared/types';
import type {DispatchController} from './useDispatchController';
export const individualRepair=(task:DispatchTask)=>(task.technicianIds??[task.technicianId]).length>1||Boolean(task.partsRequests?.length);
export function personalTask(task:DispatchTask,ownerId:string):DispatchTask {
 if(!individualRepair(task))return task;
 return {...task,items:task.items.filter(i=>i.responsibleId===ownerId),partsRequirement:task.partsRequests?.find(p=>p.ownerId===ownerId)};
}
export function partsController(c:DispatchController,ownerId?:string):DispatchController {
 if(!c.detail)return c;
 const task=c.detail.task;
 return {...c,detail:{...c.detail,task:{...task,partsRequirement:ownerId?task.partsRequests?.find(p=>p.ownerId===ownerId):task.partsRequirement}},act:input=>c.act({...input,...(ownerId?{partsOwnerId:ownerId}:{})})};
}
export function warehouseRequests(tasks:DispatchTask[]):DispatchTask[] {
 return tasks.flatMap(task=>[...(task.partsRequirement?[task]:[]),...(task.partsRequests||[]).map(parts=>({...task,partsRequirement:parts}))]);
}
