import type { DispatchTask, PartsRequirement } from './types';
export function warehouseRequests(tasks:DispatchTask[]):DispatchTask[];
export function partsStatus(parts?:PartsRequirement):string;
export function canProcessParts(task:DispatchTask):boolean;
export function matchesPartsStatus(task:DispatchTask,status:string):boolean;
export function sortWarehouseRequests(tasks:DispatchTask[],order:'newest'|'oldest'):DispatchTask[];
