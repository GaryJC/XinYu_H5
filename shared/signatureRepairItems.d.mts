import type {SignatureRepairItem, WorkOrder} from './types';
export function signatureRepairItems(order: Pick<WorkOrder, 'repairItems' | 'pendingRepairs'>): SignatureRepairItem[];
