import type {DispatchTask,UserProfile} from './types';
export function canEditDispatchTechnicians(task:DispatchTask|undefined,actor:UserProfile|undefined):boolean;
export function requiredDispatchTechnicians(task:Pick<DispatchTask,'items'|'workerSubmissions'>):string[];
