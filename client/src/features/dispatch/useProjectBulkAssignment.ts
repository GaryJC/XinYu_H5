import {useState} from 'react';
import type {DispatchItem,RepairItemEdit} from '../../../../shared/types';

export function useProjectBulkAssignment(rows:RepairItemEdit[],items:DispatchItem[],onChange:(rows:RepairItemEdit[])=>void) {
  const [selected,setSelected]=useState<number[]>([]);
  const eligible=rows.flatMap((row,index)=>items.some(item=>item.id===row.id&&['待检验','已完工'].includes(item.status))?[]:[index]);
  const selectedRows=selected.filter(index=>eligible.includes(index));
  function changeRows(next:RepairItemEdit[]) {
    if(next.length!==rows.length)setSelected([]);
    onChange(next);
  }
  function assign(index:number,responsibleId:string) {
    const targets=selectedRows.includes(index)?selectedRows:[index];
    onChange(rows.map((row,i)=>targets.includes(i)?{...row,responsibleId,responsibleName:undefined}:row));
  }
  return {selected:selectedRows,setSelected,changeRows,assign,clear:()=>setSelected([])};
}
