import {useEffect, useMemo, useState, type Dispatch, type SetStateAction} from 'react';
import {hasRole} from '../../../../../shared/roles.mjs';
import type {UserProfile, WorkOrderDraft} from '../../../../../shared/types';

export function useDirectDispatch(draft:WorkOrderDraft, setDraft:Dispatch<SetStateAction<WorkOrderDraft>>, users:UserProfile[], orderId?:string) {
  const [selectedIds,setSelectedIds]=useState<number[]>([]);
  useEffect(()=>setSelectedIds([]),[orderId]);
  useEffect(()=>{
    setSelectedIds(current=>{
      const next=draft.dispatchPlan?current.filter(id=>draft.repairItems.some(item=>item.id===id)):[];
      return next.length===current.length?current:next;
    });
  },[draft.repairItems,draft.dispatchPlan]);
  const selected=selectedIds.filter(id=>draft.repairItems.some(item=>item.id===id));
  const allSelected=draft.repairItems.length>0&&selected.length===draft.repairItems.length;
  const selectedOwners=selected.map(id=>draft.dispatchPlan?.itemAssignments?.find(row=>row.itemId===id)?.technicianId);
  const bulkValue=selectedOwners.length&&selectedOwners.every(id=>id===selectedOwners[0])?selectedOwners[0]:undefined;
  function select(itemId:number,checked:boolean) {setSelectedIds(current=>checked?[...new Set([...current,itemId])]:current.filter(id=>id!==itemId));}
  function selectAll(checked:boolean) {setSelectedIds(checked?draft.repairItems.map(item=>item.id):[]);}
  function assignSelected(technicianId:string) {
    setDraft(current=>{
      if(!current.dispatchPlan)return current;
      const ids=selected.filter(id=>current.repairItems.some(item=>item.id===id));
      if(!ids.length)return current;
      return {...current,dispatchPlan:{...current.dispatchPlan,itemAssignments:[...(current.dispatchPlan.itemAssignments||[]).filter(row=>!ids.includes(row.itemId)),...ids.map(itemId=>({itemId,technicianId}))]}};
    });
  }
  const workers=useMemo(()=>users.filter(user=>user.active&&user.shopId===draft.shop.id&&hasRole(user,'technician')),[users,draft.shop.id]);
  const options=workers.map(user=>({value:user.id,label:workers.filter(other=>other.name===user.name).length>1?`${user.name}（员工编号 ${user.id}）`:user.name}));
  // Removing a project or marking it pending must also remove its planned assignment.
  useEffect(()=>{
    if(!draft.dispatchPlan?.itemAssignments)return;
    const assignments=draft.dispatchPlan.itemAssignments.filter(row=>draft.repairItems.some(item=>item.id===row.itemId));
    if(assignments.length!==draft.dispatchPlan.itemAssignments.length)setDraft(current=>current.dispatchPlan?{...current,dispatchPlan:{...current.dispatchPlan,itemAssignments:current.dispatchPlan.itemAssignments?.filter(row=>current.repairItems.some(item=>item.id===row.itemId))}}:current);
  },[draft.repairItems,draft.dispatchPlan,setDraft]);
  function enable(enabled:boolean) {
    setSelectedIds([]);
    setDraft(current=>({...current,dispatchPlan:enabled?{executionMode:'internal',technicianIds:[],itemAssignments:[],dueAt:current.estimatedDeliveryAt||'',urgent:false,note:''}:null}));
  }
  function assign(itemId:number,technicianId:string) {
    setDraft(current=>current.dispatchPlan?{...current,dispatchPlan:{...current.dispatchPlan,itemAssignments:[...(current.dispatchPlan.itemAssignments||[]).filter(row=>row.itemId!==itemId),{itemId,technicianId}]}}:current);
  }
  function due(dueAt:string) {setDraft(current=>current.dispatchPlan?{...current,dispatchPlan:{...current.dispatchPlan,dueAt}}:current);}
  return {options,enable,assign,due,selected,allSelected,bulkValue,select,selectAll,assignSelected};
}
