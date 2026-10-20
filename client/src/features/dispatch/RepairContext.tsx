import {Tag} from 'antd';
import type {DispatchTask} from '../../../../shared/types';
export function RepairContext({task}:{task:Pick<DispatchTask,'repairRound'|'partsRequirement'>}) {
 return <span className="repair-context" aria-label="维修与领料批次">{task.repairRound?<Tag color="orange">返工单 · 第 {task.repairRound} 轮</Tag>:null}{task.partsRequirement?<Tag>本轮第 {task.partsRequirement.batch||1} 批{(task.partsRequirement.batch||1)>1?' · 补料':''}</Tag>:null}</span>;
}
