import {Tag} from 'antd';
import {RepairContext} from './RepairContext';
import type { ReactNode } from 'react';
import type { DispatchTask } from '../../../../shared/types';
import { displayTime } from './dispatchLabels';
export function TaskOverview({task,children,dueEditor,techniciansEditor}:{task:DispatchTask;children:ReactNode;dueEditor?:ReactNode;techniciansEditor?:ReactNode}) {
 return <section className="task-overview" aria-label="任务概览">
   <div className="task-overview-status">{children}{!!task.inspectionDeferredCount&&<Tag color="orange">待定 × {task.inspectionDeferredCount}</Tag>}<RepairContext task={task}/></div>
   <div className="task-overview-ref"><span>派工号</span><strong>{task.dispatchNo || task.orderId}</strong></div>
   {task.repairRound&&task.roundReason?<p className="repair-round-reason">{task.roundKind==='additional'?'追加维修原因':'返工原因'}：{task.roundReason}</p>:null}
   <dl>
     <div><dt>托修单位</dt><dd>{task.customerName || '未填写'}</dd></div>
     <div><dt>车型 / 里程</dt><dd>{task.vehicleModel || '未填写'}{task.vehicleMileage?` · ${task.vehicleMileage} km`:''}</dd></div>
     <div><dt>服务顾问</dt><dd>{task.advisor || '未填写'}</dd></div>
     <div><dt>{task.executionMode==='outsourced'?'承包方':'维修员工'}</dt><dd>{techniciansEditor || task.technicianName || '待指派'}</dd></div>
     <div className="task-due-row"><dt>预计完工</dt><dd>{dueEditor || displayTime(task.dueAt)}</dd></div>
   </dl>
 </section>;
}
