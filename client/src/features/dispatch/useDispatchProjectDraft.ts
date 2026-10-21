import {useState} from 'react';
import type {DispatchTask,RepairItemEdit} from '../../../../shared/types';

export function projectRows(task:DispatchTask,ids=task.technicianIds??(task.technicianId?[task.technicianId]:[])):RepairItemEdit[] {
  return task.items.map(item=>({id:item.id,name:item.name,responsibleId:task.stage==='待派工'?undefined:item.responsibleId??(ids.length===1?ids[0]:undefined),responsibleName:item.responsibleName}));
}

export function useDispatchProjectDraft(task:DispatchTask) {
  const [draft,setDraft]=useState<{version:number;rows:RepairItemEdit[]}>();
  const rows=draft?.rows??projectRows(task);
  const change=(rows:RepairItemEdit[])=>setDraft(current=>({version:current?.version??task.version,rows}));
  const changeTeam=(ids:string[])=>change(rows.map(row=>{
    if(task.items.some(item=>item.id===row.id&&['待检验','已完工'].includes(item.status)))return row;
    const responsibleId=row.responsibleId&&ids.includes(row.responsibleId)?row.responsibleId:ids.length===1?ids[0]:undefined;
    return {...row,responsibleId,responsibleName:undefined};
  }));
  return {rows,change,changeTeam,dirty:!!draft,stale:!!draft&&draft.version!==task.version,reset:()=>setDraft(undefined)};
}
