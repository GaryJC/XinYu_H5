import type {DispatchTask,PartsRequirement} from './types';
export function hasPendingInspection(task:DispatchTask):boolean;
export function allWorkersHaveItems(task:DispatchTask):boolean;
export function isIndividualRepair(task:DispatchTask):boolean;
export function personalRepairStage(task:DispatchTask,ownerId:string):DispatchTask['stage'];
export function hasUnpreparedParts(task:DispatchTask):boolean;
export function canStartRepairWithParts(task:Partial<DispatchTask>,ownerId?:string,sharedPartsRequirement?:PartsRequirement):boolean;

export function isReworkTask(task:DispatchTask,ownerId?:string):boolean;
