// Use the inspection snapshot, never the task's current assignee. A later
// reassignment or successful reinspection must not rewrite historical counts.
export function inspectionReturnStats(events) {
  const stats = new Map();
  for (const event of events) {
    const detail = event.detail || {};
    const items = detail.previousItems ?? detail.items ?? [];
    for (const itemId of new Set(detail.rejectedItemIds || [])) {
      const item = items.find(item => item.id === itemId);
      const ownerId = item?.responsibleId;
      if (!ownerId) continue; // Older unattributed records cannot be assigned reliably.
      if (!stats.has(ownerId)) stats.set(ownerId, { projects: new Set(), returnedItemOccurrences: 0 });
      const summary = stats.get(ownerId);
      summary.projects.add(JSON.stringify([event.orderId, itemId]));
      summary.returnedItemOccurrences += 1;
    }
  }
  return new Map([...stats].map(([id, summary]) => [id, {
    returnedItemCount: summary.projects.size,
    returnedItemOccurrences: summary.returnedItemOccurrences
  }]));
}
