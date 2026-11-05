import {completionRange} from './dispatchPolicy.mjs';
import { HttpError } from '../http/HttpError.mjs';

export function completedProjectMonth(value, now = new Date()) {
  const month = value || new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith('0000')) {
    throw new HttpError(400, '月份无效');
  }
  return month;
}

export function technicianCompletedProjects(rows, userId, month) {
  const projects = [];
  for (const row of rows) {
    const task = row.snapshot;
    const owners = task.technicianIds ?? (task.technicianId ? [task.technicianId] : []);
    for (const item of task.items || []) {
      const owner = item.responsibleId || (owners.length === 1 ? owners[0] : undefined);
      if (owner !== userId || item.status !== '已完工') continue;
      // Legacy records may only have the order's inspection completion timestamp.
      const completedAt = item.inspectedAt || item.completionRecordedAt
        || (task.executionMode === 'outsourced' ? item.finishAt : undefined) || task.completedAt;
      const timestamp = Date.parse(completedAt);
      if (!Number.isFinite(timestamp) || month && new Date(timestamp + 8 * 3600000).toISOString().slice(0, 7) !== month) continue;
      projects.push({
        key: `${row.order_id}:${row.round_no}:${item.id}`, orderId: row.order_id,
        dispatchNo: row.dispatch_no || '', plate: row.vehicle_plate, round: row.round_no,
        itemId: item.id, name: item.name, completedAt: new Date(timestamp).toISOString()
      });
    }
  }
  return projects.sort((a, b) => b.completedAt.localeCompare(a.completedAt) || a.key.localeCompare(b.key));
}

export function groupCompletedProjectsByOrder(projects) {
  const orders = new Map();
  for (const project of projects) {
    let order = orders.get(project.orderId);
    if (!order) {
      order = {key: project.orderId, orderId: project.orderId, dispatchNo: project.dispatchNo, plate: project.plate, projects: []};
      orders.set(project.orderId, order);
    }
    order.projects.push(project);
  }
  return [...orders.values()];
}

export function filterCompletedProjects(projects,query={}) {
 if(query.sort&&!['completed-asc','completed-desc'].includes(query.sort))throw new HttpError(400,'排序方式无效');
 const range=query.from||query.to?completionRange(query.from,query.to):undefined;
 return projects.filter(p=>!range||(p.completedAt>=range.from&&p.completedAt<range.to)).sort((a,b)=>(query.sort==='completed-asc'?1:-1)*a.completedAt.localeCompare(b.completedAt)||a.key.localeCompare(b.key));
}
