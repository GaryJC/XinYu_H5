import type {DispatchEvent} from '../../../../shared/types';

// Present one atomic batch event as per-application audit entries.
export function partsHistoryEvents(events:DispatchEvent[]):DispatchEvent[] {
 return events.flatMap(event=>event.detail.preparationGroups?.map((group,index)=>({
  ...event,id:`${event.id}-${index}`,detail:{...event.detail,preparationGroups:undefined,partsRequirement:group.partsRequirement,partsPreparation:group.items}
 }))??[event]);
}
