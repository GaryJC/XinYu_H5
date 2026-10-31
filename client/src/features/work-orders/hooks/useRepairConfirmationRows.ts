import { createRequestId } from "../../../shared/api/requestId";
import type {Dispatch,SetStateAction} from 'react';
import type {WorkOrderDraft,RepairItem,PendingRepair} from '../../../../../shared/types';
type Row={key:string;name:string;pending:boolean;repair?:RepairItem;confirmation?:PendingRepair;position:number};
export function useRepairConfirmationRows(draft:WorkOrderDraft,setDraft:Dispatch<SetStateAction<WorkOrderDraft>>) {
 const rows:Row[]=[
  ...draft.repairItems.map(repair=>({key:`repair-${repair.id}`,name:repair.name,pending:false,repair,position:repair.id})),
  ...(draft.pendingRepairs||[]).filter(p=>!p.scheduled).map(confirmation=>({key:`pending-${confirmation.id}`,name:confirmation.name,pending:true,confirmation,position:confirmation.draftItemId??confirmation.itemId}))
 ].sort((a,b)=>a.position-b.position);
 function changeName(row:Row,name:string){setDraft(current=>row.confirmation?{...current,pendingRepairs:(current.pendingRepairs||[]).map(p=>p.id===row.confirmation!.id?{...p,name}:p)}:{...current,repairItems:current.repairItems.map(p=>p.id===row.repair!.id?{...p,name}:p)});}
 function toggle(row:Row,pending:boolean){
  if(row.pending===pending)return;
  setDraft(current=>{
   if(pending&&row.repair){const p:PendingRepair={id:createRequestId(),itemId:0,draftItemId:row.repair.id,name:row.name,reason:'接车登记，待司机向公司确认',state:'pending',scheduled:false,history:[]};return {...current,repairItems:current.repairItems.filter(i=>i.id!==row.repair!.id),pendingRepairs:[...(current.pendingRepairs||[]),p]};}
   if(row.confirmation){const p=row.confirmation;return {...current,pendingRepairs:(current.pendingRepairs||[]).filter(i=>i.id!==p.id),repairItems:[...current.repairItems,{id:p.draftItemId??p.itemId,name:p.name,laborFee:0,owner:'待派工',startAt:'',finishAt:'',inspector:'待检验',status:'待派工'}]};}
   return current;
  });
 }
 function remove(row:Row){setDraft(current=>row.confirmation?{...current,pendingRepairs:(current.pendingRepairs||[]).filter(p=>p.id!==row.confirmation!.id)}:{...current,repairItems:current.repairItems.filter(p=>p.id!==row.repair!.id)});}
 return {rows,changeName,toggle,remove};
}
