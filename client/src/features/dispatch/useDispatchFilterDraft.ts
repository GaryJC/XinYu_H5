import {useEffect,useRef,useState} from 'react';
import type {DispatchFilters} from './dispatchApi';
import type {Dispatch,SetStateAction} from 'react';

export function advancedFilterCount(filters:DispatchFilters) {
 return Number(Boolean(filters.executionMode))+Number(Boolean(filters.from||filters.to))+Number(Boolean(filters.technicianId));
}
export function activeFilterCount(filters:DispatchFilters) {
 return advancedFilterCount(filters)+Number(Boolean(filters.search))+Number(Boolean(filters.stage))+Number(Boolean(filters.metric))+Number(filters.urgent==='true')+Number(filters.overdue==='true');
}
export function filterDateError(filters:DispatchFilters) {
 return filters.from&&filters.to&&filters.from>filters.to?'开始日期不能晚于结束日期':'';
}
export function useDispatchFilterDraft(filters:DispatchFilters,setFilters:Dispatch<SetStateAction<DispatchFilters>>) {
 const [open,setOpen]=useState(false),[draft,setDraft]=useState<DispatchFilters>({});
 const [search,setSearch]=useState(filters.search||''),[error,setError]=useState('');
 const composing=useRef(false);
 useEffect(()=>{setSearch(filters.search||'');},[filters.search]);
 function begin(){setDraft({...filters});setError('');setOpen(true);}
 function cancel(){setOpen(false);setError('');}
 function reset(){setDraft({});setError('');}
 function confirm(){const message=filterDateError(draft);setError(message);if(message)return;setSearch(draft.search||'');setFilters({...draft});setOpen(false);}
 function submitSearch(value:string){if(composing.current)return;setSearch(value);setFilters(f=>({...f,search:value.trim()||undefined}));}
 function clear(){setSearch('');setFilters({});}
 return {open,draft,setDraft,search,setSearch,error,setError,composing,begin,cancel,reset,confirm,submitSearch,clear};
}
