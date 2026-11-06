import {useEffect,useRef,useState} from 'react';
import type {DispatchFilters} from './dispatchApi';
import type {Dispatch,SetStateAction} from 'react';

export function searchAllFilters(value:string):DispatchFilters {
 const search=value.trim();
 return search?{search,includeCompleted:'true'}:{};
}
export function selectStatusFilters(filters:DispatchFilters,stage:string):DispatchFilters {
 return {...filters,stage:stage==='all'?undefined:stage||undefined,includeCompleted:stage==='all'?'true':undefined,metric:undefined,workloadState:undefined};
}

export function advancedFilterCount(filters:DispatchFilters) {
 return Number(Boolean(filters.executionMode))+Number(Boolean(filters.from||filters.to))+Number(Boolean(filters.technicianId));
}
export function activeFilterCount(filters:DispatchFilters) {
 return advancedFilterCount(filters)+Number(Boolean(filters.search))+Number(Boolean(filters.stage))+Number(Boolean(filters.metric||filters.workloadState))+Number(filters.urgent==='true')+Number(filters.overdue==='true');
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
 function reset(){setDraft({sort:filters.sort,search:filters.search,includeCompleted:filters.includeCompleted});setError('');}
 function confirm(){const message=filterDateError(draft);setError(message);if(message)return;setSearch(draft.search||'');setFilters({...draft});setOpen(false);}
 function submitSearch(value:string){if(composing.current)return;setSearch(value.trim());setFilters(current=>({...searchAllFilters(value),sort:current.sort}));}
 function clear(){setSearch('');setFilters(current=>({sort:current.sort}));}
 return {open,draft,setDraft,search,setSearch,error,setError,composing,begin,cancel,reset,confirm,submitSearch,clear};
}
