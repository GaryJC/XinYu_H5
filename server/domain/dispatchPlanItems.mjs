import { HttpError } from '../http/HttpError.mjs';

// Match stable item IDs, never names or row positions. Pending items are not in items.
export function applyPlannedResponsibilities(items, assignments) {
  if (!Array.isArray(assignments) || assignments.length !== items.length || !items.length
    || assignments.some(row => !row || !Number.isSafeInteger(row.itemId) || typeof row.technicianId !== 'string' || !row.technicianId || row.technicianId.length > 200)
    || new Set(assignments.map(row => row.itemId)).size !== assignments.length
    || assignments.some(row => !items.some(item => item.id === row.itemId))) {
    throw new HttpError(400, '直接派工须为每个非待定维修项目选择一名负责人');
  }
  return items.map(item => ({...item, responsibleId: assignments.find(row => row.itemId === item.id).technicianId}));
}
