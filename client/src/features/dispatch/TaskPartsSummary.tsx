import type { DispatchTask } from '../../../../shared/types';
import { PartsRequirementSummary } from './PartsRequirementSummary';

export function TaskPartsSummary({task}:{task:DispatchTask}) {
  const requests=task.partsRequests||[];
  return <>
    {(task.partsRequirement||!requests.length)&&<PartsRequirementSummary value={task.partsRequirement} title={requests.length?'共同配件':'所需配件'}/>}
    {requests.map((parts,index)=>{
      const name=parts.ownerName||task.items.find(item=>item.responsibleId===parts.ownerId)?.responsibleName||parts.ownerId||'维修工';
      return <PartsRequirementSummary key={parts.ownerId||index} value={parts} title={task.executionMode==='outsourced'?`历史配件申请 · ${name}`:`${name} · 配件`}/>;
    })}
  </>;
}
