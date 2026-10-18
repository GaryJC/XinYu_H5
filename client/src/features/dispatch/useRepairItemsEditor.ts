import {useState} from 'react';
import type {DispatchTask,RepairItemEdit} from '../../../../shared/types';
import type {DispatchController} from './useDispatchController';
export function useRepairItemsEditor(task:DispatchTask,c:DispatchController) {
 const [editing,setEditing]=useState(false),[rows,setRows]=useState<RepairItemEdit[]>([]),[version,setVersion]=useState(task.version);
 const begin=()=>{setRows(task.items.map(({id,name})=>({id,name})));setVersion(task.version);setEditing(true);};
 const cancel=()=>setEditing(false);
 const valid=rows.length>0&&rows.length<=200&&rows.every(row=>Boolean(row.name.trim())&&row.name.length<=200);
 const stale=editing&&version!==task.version;
 async function save(submit=false,note='') {
  if(!valid||stale||c.busy)return false;
  const success=await c.act({action:submit?'submit-order':'edit-repair-items',repairItems:rows,note});
  if(success)cancel();return success;
 }
 return {editing,rows,setRows,begin,cancel,valid,stale,save};
}
