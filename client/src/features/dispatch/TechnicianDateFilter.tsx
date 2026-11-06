import {dispatchNumberSortOptions} from '../../../../shared/dispatchNumberSort.mjs';
import {useState} from 'react';
import type {Dispatch,SetStateAction} from 'react';
import {Alert,Button,Drawer,Input,Select} from 'antd';
import {assignmentDateShortcuts} from './assignmentDateShortcuts';
import type {DispatchFilters} from '../../../../shared/types';

export function TechnicianDateFilter({filters,setFilters}:{filters:DispatchFilters;setFilters:Dispatch<SetStateAction<DispatchFilters>>}) {
 const [open,setOpen]=useState(false),[from,setFrom]=useState(''),[to,setTo]=useState('');
 const shortcuts=assignmentDateShortcuts();
 const selected=shortcuts.find(option=>option.from===(filters.assignedFrom||'')&&option.to===(filters.assignedTo||''))?.key||'custom';
 const invalid=Boolean(from&&to&&from>to);
 function apply(){if(invalid)return;setFilters(current=>({...current,assignedFrom:from||undefined,assignedTo:to||undefined}));setOpen(false);}
 return <>
  <div className="technician-date-filter" role="group" aria-label="派工日期筛选">
   <div className="technician-date-heading"><span className="technician-date-label">排序方式</span>
      <Select className="technician-sort" size="small" aria-label="维修任务排序" value={filters.sort||'dispatch-desc'} onChange={sort=>setFilters(current=>({...current,sort}))} options={[...dispatchNumberSortOptions,
        {value:'assigned-asc',label:'派工时间：早 → 晚'},
        {value:'assigned-desc',label:'派工时间：晚 → 早'},
        {value:'due-asc',label:'预计完工：早 → 晚'},
        {value:'due-desc',label:'预计完工：晚 → 早'}
      ]}/>
   </div>
   <div className="technician-date-shortcuts">
    {shortcuts.map(option=><Button key={option.key} type="text" size="small" autoInsertSpace={false} aria-pressed={selected===option.key} className={selected===option.key?'is-selected':undefined} onClick={()=>setFilters(current=>({...current,assignedFrom:option.from||undefined,assignedTo:option.to||undefined}))}>{option.label}</Button>)}
    <Button type="text" size="small" aria-pressed={selected==='custom'} className={selected==='custom'?'is-selected':undefined} onClick={()=>{setFrom(filters.assignedFrom||'');setTo(filters.assignedTo||'');setOpen(true);}}>自定义</Button>
   </div>
   {selected==='custom'&&<span className="technician-date-range">{filters.assignedFrom||'不限'} 至 {filters.assignedTo||'不限'}</span>}
  </div>
  <Drawer title="派工日期" placement="bottom" size="auto" open={open} onClose={()=>setOpen(false)} footer={<div className="technician-date-actions"><Button onClick={()=>{setFrom('');setTo('');}}>重置</Button><Button type="primary" disabled={invalid} onClick={apply}>确定</Button></div>}>
   <div className="technician-date-fields">
    <label>开始日期<Input type="date" aria-label="派工开始日期" value={from} max={to||undefined} onChange={e=>setFrom(e.target.value)}/></label>
    <label>结束日期<Input type="date" aria-label="派工结束日期" value={to} min={from||undefined} onChange={e=>setTo(e.target.value)}/></label>
   </div>
   {invalid&&<Alert type="error" title="开始日期不能晚于结束日期"/>}
  </Drawer>
 </>;
}
