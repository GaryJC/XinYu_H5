import { hasAnyRole } from '../../shared/roles.mjs';
import { HttpError } from '../http/HttpError.mjs';
import { pageResult } from '../domain/pagination.mjs';
import { filterCompletedProjects, completedProjectMonth, technicianCompletedProjects, groupCompletedProjectsByOrder } from '../domain/technicianCompletedProjects.mjs';
import { readCompletedProjectSnapshots } from '../repositories/technicianCompletedProjectsRepository.mjs';

export async function myCompletedProjects(actor, query = {}) {
  if (!actor.active || !actor.id || !hasAnyRole(actor, ['technician','outsourcing']) && !actor.outsourcingRoleMember) {
    throw new HttpError(403, '仅维修工可查看本人完工项目');
  }
  const month = completedProjectMonth(query.month);
  const rows = await readCompletedProjectSnapshots(actor.shopId, actor.id);
  const projects = filterCompletedProjects(technicianCompletedProjects(rows, actor.id, query.from||query.to?undefined:month),query);
  if (query.groupBy === 'order') {
    return {...pageResult(groupCompletedProjectsByOrder(projects), query), counts: {projects: projects.length}};
  }
  return pageResult(projects, query);
}
