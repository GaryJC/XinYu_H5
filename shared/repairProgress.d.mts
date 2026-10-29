import type {DispatchTask} from './types';
export function hasPendingInspection(task:DispatchTask):boolean;
export function allWorkersHaveItems(task:DispatchTask):boolean;
export function isIndividualRepair(task:DispatchTask):boolean;
export function hasUnpreparedParts(task:DispatchTask):boolean;
