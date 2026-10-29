import type {DispatchStage,WorkOrderStatus} from './types';
export function isRepairCompleted(stage: string | undefined, orderStatus: string): boolean;
export function repairStatusLabel(stage: DispatchStage | undefined, orderStatus: WorkOrderStatus): DispatchStage | WorkOrderStatus;
export function repairCategory(status: string): string;
