import {useState} from 'react';
import type {DispatchTask} from '../../../../shared/types';
import {summarizeInspection,type InspectionChoices} from './inspectionReview';
export function useInspectionDraft(task?:DispatchTask) {
 const [draft,setDraft]=useState<{orderId:string;version:number;choices:InspectionChoices}>();
 const choices=draft&&task&&draft.orderId===task.orderId&&draft.version===task.version?draft.choices:{};
 const change=(id:number,value:'pass'|'return')=>{if(task)setDraft({orderId:task.orderId,version:task.version,choices:{...choices,[id]:value}});};
 return {choices,change,...summarizeInspection(task?.items||[],choices)};
}
