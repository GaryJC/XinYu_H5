import {useState} from 'react';
import type {DispatchExecution,DispatchTask,RepairItemEdit} from '../../../../shared/types';
import {localDateTime} from './dispatchLabels';
import type {ActionInput} from './useDispatchController';

function executionFor(task:DispatchTask):DispatchExecution {
  return Object.fromEntries(['executionMode','serviceUnit','serviceAddress','serviceContact','departureAt','expectedReturnAt','returnedAt','contractor','contractorId','outsourcingMode','agreedFee','handedOverAt','receivedAt'].map(key=>[key,task[key as keyof DispatchExecution]]));
}

export function useInlineDispatch(task:DispatchTask,onEdit:()=>void) {
  const initial=():{execution:DispatchExecution;dueAt:string;urgent:boolean;note:string}=>({execution:{...executionFor(task),executionMode:task.executionMode||'internal'},dueAt:localDateTime(task.dueAt),urgent:Boolean(task.urgent),note:task.note||''});
  const [draft,setDraft]=useState<ReturnType<typeof initial>>();
  const {execution,dueAt,urgent,note}=draft??initial();
  const change=(patch:Partial<ReturnType<typeof initial>>)=>{onEdit();setDraft(current=>({...(current??initial()),...patch}));};
  const changeExecution=(execution:DispatchExecution)=>change({execution});
  const changeDueAt=(dueAt:string)=>change({dueAt});
  const changeUrgent=(urgent:boolean)=>change({urgent});
  const changeNote=(note:string)=>change({note});
  const validTime=Boolean(dueAt)&&Number.isFinite(Date.parse(`${dueAt}:00+08:00`));
  const mode=execution.executionMode||'internal';
  const validExecution=mode==='field'?Boolean(execution.serviceUnit?.trim()&&execution.serviceAddress?.trim()):mode==='outsourced'?Boolean(execution.contractor?.trim()&&execution.outsourcingMode):true;
  function request(rows:RepairItemEdit[]):ActionInput {
    const input:ActionInput={...execution,action:'assign',technicianIds:mode==='outsourced'?[]:[...new Set(rows.map(row=>row.responsibleId).filter((id):id is string=>Boolean(id)))],repairItems:rows.map(row=>({id:row.id,name:row.name,...(mode!=='outsourced'?{responsibleId:row.responsibleId}:{})})),dueAt:new Date(`${dueAt}:00+08:00`).toISOString(),urgent,note};
    if(task.repairRound)delete input.agreedFee;
    return input;
  }
  function reset() {setDraft(undefined);}
  return {execution,dueAt,urgent,note,changeExecution,changeDueAt,changeUrgent,changeNote,valid:validTime&&validExecution,request,reset};
}
