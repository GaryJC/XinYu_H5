import { CarFront } from 'lucide-react';
import {Tag} from 'antd';
import {RepairContext} from './RepairContext';
import type { ReactNode } from 'react';
import type { DispatchTask } from '../../../../shared/types';
import { displayTime } from './dispatchLabels';
export function TaskOverview({task,children,dueEditor,techniciansEditor,compact=false}:{task:DispatchTask;children:ReactNode;dueEditor?:ReactNode;techniciansEditor?:ReactNode;compact?:boolean}) {
 return <section className={`task-overview${compact?" is-compact":""}`} aria-label="任务概览">
   <div className="task-overview-identity"><span className="task-vehicle-icon"><CarFront size={24} aria-hidden="true" /></span><div><span className="task-overview-eyebrow">维修任务</span><h2>{task.plate || '未填写车牌'}</h2><p>{task.vehicleModel || '车型待补充'}{task.vehicleMileage ? ` · ${task.vehicleMileage} km` : ''}</p></div></div>
   <div className="task-overview-status">{children}{!!task.inspectionDeferredCount&&<Tag color="orange">待定 × {task.inspectionDeferredCount}</Tag>}<RepairContext task={task}/></div>
   {!compact&&<>   <div className="task-overview-ref"><span>{task.dispatchNo ? '派工号' : '委托单号'}</span><strong>{task.dispatchNo || task.orderId}</strong></div>
   {task.repairRound&&task.roundReason?<p className="repair-round-reason">{task.roundKind==='additional'?'追加维修原因':'返工原因'}：{task.roundReason}</p>:null}
</>}
   <dl>
     {!compact&&<div className="task-overview-customer"><dt>托修单位</dt><dd>{task.customerName || '未填写'}</dd></div>}
     {!compact&&<div><dt>服务顾问</dt><dd>{task.advisor || '未填写'}</dd></div>}
     <div><dt>{task.executionMode==='outsourced'?'承包方':'维修员工'}</dt><dd>{techniciansEditor || task.technicianName || '待指派'}</dd></div>
     <div className="task-due-row task-overview-wide"><dt>预计完工</dt><dd>{dueEditor || displayTime(task.dueAt)}</dd></div>
   </dl>
   {compact&&<details className="task-overview-more"><summary>车辆与委托信息</summary>   <div className="task-overview-ref"><span>{task.dispatchNo ? '派工号' : '委托单号'}</span><strong>{task.dispatchNo || task.orderId}</strong></div>
   {task.repairRound&&task.roundReason?<p className="repair-round-reason">{task.roundKind==='additional'?'追加维修原因':'返工原因'}：{task.roundReason}</p>:null}
<dl><div><dt>托修单位</dt><dd>{task.customerName || '未填写'}</dd></div><div><dt>服务顾问</dt><dd>{task.advisor || '未填写'}</dd></div></dl></details>}
 </section>;
}
