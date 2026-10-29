import {isRepairCompleted} from '../../shared/repairCompletion.mjs';
import {hasRole,hasAnyRole} from '../../shared/roles.mjs';
import {hasPendingInspection} from '../../shared/repairProgress.mjs';
import {hasActiveRepairRound} from './repairRounds.mjs';
import {completionRange,dispatchMetric,technicianIds} from './dispatchPolicy.mjs';
import {HttpError} from '../http/HttpError.mjs';
export function filterDispatchTasks(tasks, actor, query={}) {
  const range=completionRange(query.from,query.to);
  const executionModes=query.executionMode?query.executionMode.split(','):[];
  if(executionModes.some(mode=>!['internal','field','outsourced'].includes(mode))) throw new HttpError(400,'执行方式筛选无效');
  return tasks.filter(t=> {
    if(query.technicianId && !technicianIds(t).includes(query.technicianId)) return false;
    if(executionModes.length && !executionModes.includes(t.executionMode||'internal')) return false;
    if(query.stage==='进行中' && !['待开工','维修中','暂停'].includes(t.stage)) return false;
    if(query.stage==='已完成') { if(!isRepairCompleted(t.stage,t.orderStatus))return false; }
    else if(query.stage==='完成') { if(t.orderStatus!=='完成' || hasActiveRepairRound(t)) return false; }
    else if(query.stage==='待结算') { if(t.orderStatus!=='待结算' || hasActiveRepairRound(t)) return false; }
    else if(query.stage==='待定') {if(!t.inspectionDeferredCount)return false;}
    else if(query.stage==='待客户确认') {if(!t.pendingRepairCount) return false;}
    else if(query.stage==='待检验') {if(!hasPendingInspection(t))return false;}
    else if(query.stage && query.stage!=='进行中' && t.stage!==query.stage) return false;
    if(query.urgent==='true' && !t.urgent) return false;
    if(query.overdue==='true' && !t.overdue) return false;
    if(query.search && ![t.orderId,t.dispatchNo,t.plate].some(v=>v.toLowerCase().includes(query.search.toLowerCase()))) return false;
    if(hasRole(actor, 'warehouse')&&!hasAnyRole(actor,['manager','advisor','inspector'])) return true;
    if(query.includeCompleted!=='true' && isRepairCompleted(t.stage,t.orderStatus) && !['已完成','完成','维修完成','待结算','待客户确认','待定'].includes(query.stage) && query.metric!=='completed') return false;
    if(query.metric) return dispatchMetric(t,query.metric,range.from,range.to);
    // The unified completed view includes all dates unless a date range is chosen.
    if(query.stage==='已完成')return !t.completedAt||(!query.from&&!query.to)||dispatchMetric(t,'completed',range.from,range.to);
    if(['完成','维修完成'].includes(query.stage)) return !t.completedAt || dispatchMetric(t,'completed',range.from,range.to);
    return query.includeCompleted==='true' || ['待客户确认','待定'].includes(query.stage) || t.orderStatus!=='完成' || hasActiveRepairRound(t);
  });
}
