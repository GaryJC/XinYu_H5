import {useState} from 'react';
import type {DispatchTask,RepairItemEdit} from '../../../../shared/types';

export function useProjectReassignment(task:DispatchTask) {
  const [draft,setDraft]=useState<{version:number;owners:Record<number,string>}>();
  const owners=draft?.owners??{};
  const selected=Object.keys(owners).map(Number);
  const change=(id:number,owner:string|undefined)=>setDraft(current=>{
    const owners={...current?.owners};
    if(owner===undefined)delete owners[id];else owners[id]=owner;
    return {version:current?.version??task.version,owners};
  });
  const rows:RepairItemEdit[]=selected.map(id=>({id,name:task.items.find(i=>i.id===id)?.name||'',responsibleId:owners[id]}));
  return {selected,owners,change,rows,stale:!!draft&&draft.version!==task.version,valid:selected.length>0&&rows.every(row=>row.responsibleId)};
}
