import type { DispatchTask } from '../../../../shared/types';
import { personalRepairStage } from '../../../../shared/repairProgress.mjs';
import { taskStatusLabel } from './dispatchLabels';

// A display projection only: action availability still uses the actual workflow state.
export function technicianTaskStatus(task: DispatchTask, ownerId: string): string {
  return taskStatusLabel({...task,stage:personalRepairStage(task,ownerId)});
}
