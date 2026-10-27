import type {DispatchItem} from '../../../../shared/types';
export type InspectionChoices=Record<number,'pass'|'return'|'deferred'>;
export type InspectionReview={version:number;choices:InspectionChoices};
export function summarizeInspection(items:DispatchItem[],choices:InspectionChoices) {
 const pending=items.filter(item=>item.status==='待检验');
 return {pending,deferredItemIds:pending.filter(item=>choices[item.id]==='deferred').map(item=>item.id),complete:pending.length>0&&pending.every(item=>choices[item.id]==='pass'||choices[item.id]==='return'||choices[item.id]==='deferred'),rejectedItemIds:pending.filter(item=>choices[item.id]==='return').map(item=>item.id)};
}
