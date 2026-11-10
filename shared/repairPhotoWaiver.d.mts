import type {DispatchTask,UserProfile,RepairPhotoWaiver} from './types';
export function repairPhotoWaiverScope(task:DispatchTask,id:string):string;
export function currentPhotoWaiver(task:DispatchTask,id:string):RepairPhotoWaiver|undefined;
export function hasApprovedPhotoWaiver(task:DispatchTask,id:string):boolean;
export function canRequestPhotoWaiver(task:DispatchTask,actor:UserProfile):boolean;
export function pendingPhotoWaivers(task:DispatchTask):RepairPhotoWaiver[];
