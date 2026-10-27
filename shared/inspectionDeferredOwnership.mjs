// Use the inspector who deferred this item, never the current task assignee.
export function inspectionDeferredOwner(entry) {
 const origin=[...(entry.history||[])].reverse().find(event=>event.action==='检验待定');
 return {id:entry.sourceInspectorId||origin?.actorId,name:entry.sourceInspectorName||origin?.actor||'原检验人'};
}
