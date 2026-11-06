import {compareDispatchNumbers} from '../../shared/dispatchNumberSort.mjs';
import {personalRepairStage} from '../../shared/repairProgress.mjs';
import {HttpError} from '../http/HttpError.mjs';

export function sortDispatchTasks(tasks,actor,query={}) {
 const sort=query.sort || 'dispatch-desc';
 if(sort==='dispatch-desc'||sort==='dispatch-asc')return [...tasks].sort((a,b)=>compareDispatchNumbers(a,b,sort));
 if(!['assigned-asc','assigned-desc','due-asc','due-desc'].includes(sort))throw new HttpError(400,'排序方式无效');
 const field=sort.startsWith('assigned-')?'assignedAt':'dueAt';
 const direction=sort.endsWith('-desc')?-1:1;
 const priority=task=>{
  if(!['待处理','回审&维修中'].includes(query.stage))return 0;
  const stage=query.personal==='true'?personalRepairStage(task,actor.id):task.stage;
  if(stage==='回审')return 0;
  return (task.repairRound?task.roundKind!=='additional':task.rework)?1:2;
 };
 return tasks.map(task=>({task,priority:priority(task),time:Date.parse(task[field])})).sort((a,b)=>{
  if(a.priority!==b.priority)return a.priority-b.priority;
  const aValid=Number.isFinite(a.time),bValid=Number.isFinite(b.time);
  if(aValid!==bValid)return aValid?-1:1;
  return aValid&&a.time!==b.time?(a.time-b.time)*direction:0;
 }).map(entry=>entry.task);
}
