import type {DispatchTask,PartsRequirement} from './types';
export function hasPendingInspection(task:DispatchTask):boolean;
export function allWorkersHaveItems(task:DispatchTask):boolean;
export function isIndividualRepair(task:DispatchTask):boolean;
export function personalRepairStage(task:DispatchTask,ownerId:string):DispatchTask['stage'];
export function personalWorkOffer(task:Partial<DispatchTask>,ownerId?:string):NonNullable<DispatchTask['workerOffers']>[string]|undefined;
export function declinedWorkOffers(task:DispatchTask):Array<[string,NonNullable<DispatchTask['workerOffers']>[string]]>;
export function hasDeclinedWork(task:DispatchTask):boolean;
export function personalFeedback(task:DispatchTask,ownerId:string):string|undefined;
export function hasUnpreparedParts(task:DispatchTask):boolean;
export function canStartRepairWithParts(task:Partial<DispatchTask>,ownerId?:string,sharedPartsRequirement?:PartsRequirement):boolean;

export function isReworkTask(task:DispatchTask,ownerId?:string):boolean;

export function hasUnpreparedSharedParts(task:DispatchTask,ownerId:string):boolean;
