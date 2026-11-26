import { openTaskProjects } from './operationsDashboard.mjs';
import { pageResult } from './pagination.mjs';

export const onsiteCategories = ['aged', 'overdue', 'parts', 'inspection'];
const day = 86_400_000;

function waitTimestamp(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function earliestWait(projects) {
  let earliest = Infinity;
  for (const project of projects) {
    const time = Date.parse(project.waitingSince);
    if (time < earliest) earliest = time;
  }
  return earliest;
}

export function onsiteOrders(orders, people, now, requestedCategory, requestedPage, pageSize) {
  const groups = { aged: [], overdue: [], parts: [], inspection: [] };
  const peopleById = new Map(people.map(person => [person.id, person]));
  for (const task of orders) {
    const created = new Date(task.createdAt);
    const order = { orderId: task.orderId, dispatchNo: task.dispatchNo, plate: task.plate,
      stage: task.stage, createdAt: created.toISOString(), dueAt: task.dueAt || undefined };
    if (now - created > 7 * day) groups.aged.push({ ...order, projects: [], sortTime: +created });
    const projects = openTaskProjects(task, peopleById, now);
    for (const category of ['overdue', 'parts', 'inspection']) {
      const matches = projects.filter(project => project.flags.includes(category));
      if (!matches.length) continue;
      const details = matches.map(project => ({
        name: project.name, ownerName: project.ownerName,
        waitingSince: waitTimestamp(category === 'parts' ? project.partsWaitingSince : project.waitingSince)
      }));
      const sortTime = category === 'overdue' ? Date.parse(task.dueAt) : earliestWait(details);
      groups[category].push({ ...order, sortTime, projects: details });
    }
  }
  const counts = Object.fromEntries(onsiteCategories.map(c => [c, groups[c].length]));
  const category = requestedCategory ?? (counts.overdue ? 'overdue' : onsiteCategories.find(c => counts[c]) ?? 'overdue');
  const rows = groups[category];
  rows.sort((a, b) => a.sortTime - b.sortTime || a.createdAt.localeCompare(b.createdAt) || a.orderId.localeCompare(b.orderId));
  const page = pageResult(rows, { page: requestedPage, pageSize });
  const items = page.items.map(({ sortTime, ...order }) => order);
  return { generatedAt: now.toISOString(), category, counts, ...page, items };
}
