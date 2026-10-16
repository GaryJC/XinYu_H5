import type { ReactNode } from 'react';
import type { DispatchTask } from '../../../../shared/types';
import { displayTime } from './dispatchLabels';
export function TaskOverview({task,children}:{task:DispatchTask;children:ReactNode}) {
 return <section className="task-overview" aria-label="任务概览">
   <div className="task-overview-status">{children}</div>
   <div className="task-overview-ref">派工号 {task.dispatchNo || task.orderId}</div>
   <dl>
     <div><dt>托修单位</dt><dd>{task.customerName || '未填写'}</dd></div>
     <div><dt>车型 / 里程</dt><dd>{task.vehicleModel || '未填写'}{task.vehicleMileage?` · ${task.vehicleMileage} km`:''}</dd></div>
     <div><dt>{task.executionMode==='outsourced'?'承包方':'维修员工'}</dt><dd>{task.technicianName || '待指派'}</dd></div>
     <div><dt>预计完工</dt><dd>{displayTime(task.dueAt)}</dd></div>
   </dl>
 </section>;
}
