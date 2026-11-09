import {listDispatchTasks,readDispatchPeople} from '../repositories/dispatchRepository.mjs';
import {buildOperationsDashboard} from '../domain/operationsDashboard.mjs';
import {requireAnyRole} from '../domain/accessPolicy.mjs';
export async function operationsDashboard(actor){
 requireAnyRole(actor,['manager']);
 return readWorkload(actor);
}
export async function dispatchWorkload(actor){
 requireAnyRole(actor,['manager','advisor']);
 return readWorkload(actor);
}
async function readWorkload(actor){
 const [tasks,people]=await Promise.all([listDispatchTasks(actor),readDispatchPeople(actor)]);
 return buildOperationsDashboard(tasks,people);
}
