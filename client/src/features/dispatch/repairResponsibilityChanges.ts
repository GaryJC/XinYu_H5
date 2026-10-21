import type {DispatchTask,RepairItemEdit} from '../../../../shared/types';

export function hasResponsibilityHandover(task:DispatchTask,rows:RepairItemEdit[]) {
  return task.stage!=='待派工'&&task.executionMode!=='outsourced'&&task.items.some(item=>
    item.responsibleId&&rows.some(row=>row.id===item.id&&row.responsibleId!==undefined&&row.responsibleId!==item.responsibleId));
}
