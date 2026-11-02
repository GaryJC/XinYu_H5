import {listDispatchTasks,dispatchPeople} from '../repositories/dispatchRepository.mjs';
import {buildOperationsDashboard} from '../domain/operationsDashboard.mjs';
import {requireAnyRole} from '../domain/accessPolicy.mjs';
export async function operationsDashboard(actor){
 requireAnyRole(actor,['manager']);
 const [tasks,people]=await Promise.all([listDispatchTasks(actor),dispatchPeople(actor)]);
 return buildOperationsDashboard(tasks,people);
}
