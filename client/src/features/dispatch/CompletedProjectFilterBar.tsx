import {useState} from 'react';
import type {Dispatch,SetStateAction} from 'react';
import {Button,DatePicker,Select} from 'antd';
import dayjs from 'dayjs';
import type {CompletedProjectFilters} from '../../../../shared/types';
import {assignmentDateShortcuts} from './assignmentDateShortcuts';

export function CompletedProjectFilterBar({filters,setFilters}:{filters:CompletedProjectFilters;setFilters:Dispatch<SetStateAction<CompletedProjectFilters>>}) {
 const [custom,setCustom]=useState(false),[from,setFrom]=useState(''),[to,setTo]=useState('');
 const ranges=assignmentDateShortcuts().map(r=>({...r,label:r.key==='all'?'所选月份':r.label}));
 const selected=ranges.find(r=>r.from===(filters.from||'')&&r.to===(filters.to||''))?.key||'custom';
 return <div className="completed-project-filters">
  <div className="completed-filter-heading"><span>完工日期</span><Select size="small" aria-label="完工项目排序" value={filters.sort||'completed-desc'} onChange={sort=>setFilters(current=>({...current,sort}))} options={[{value:'completed-desc',label:'完工时间：晚 → 早'},{value:'completed-asc',label:'完工时间：早 → 晚'}]}/></div>
  <div className="completed-date-shortcuts">{ranges.map(r=><Button type="text" size="small" key={r.key} aria-pressed={selected===r.key} className={selected===r.key?'is-selected':undefined} onClick={()=>{setFilters(current=>({...current,from:r.from||undefined,to:r.to||undefined}));setCustom(false);}}>{r.label}</Button>)}<Button type="text" size="small" aria-pressed={selected==='custom'} className={selected==='custom'?'is-selected':undefined} onClick={()=>{setFrom(filters.from||'');setTo(filters.to||'');setCustom(true);}}>自定义</Button></div>
  {custom&&<div className="completed-custom-dates">
   <DatePicker aria-label="完工开始日期" placeholder="开始日期" value={from?dayjs(from):null} onChange={date=>setFrom(date?.format('YYYY-MM-DD')||'')}/>
   <DatePicker aria-label="完工结束日期" placeholder="结束日期" value={to?dayjs(to):null} onChange={date=>setTo(date?.format('YYYY-MM-DD')||'')}/>
   <Button type="primary" disabled={!from&&!to||Boolean(from&&to&&from>to)} onClick={()=>{setFilters(current=>({...current,from:from||undefined,to:to||undefined}));setCustom(false);}}>应用</Button>
  </div>}
 </div>;
}
