import {buildOperationsDashboard} from './operationsDashboard.mjs';
import {isRepairCompleted} from '../../shared/repairCompletion.mjs';
import {hasRole,hasAnyRole} from '../../shared/roles.mjs';
import {hasPendingInspection,isIndividualRepair,personalRepairStage} from '../../shared/repairProgress.mjs';
import {hasActiveRepairRound} from './repairRounds.mjs';
import {completionRange,dispatchMetric,technicianIds} from './dispatchPolicy.mjs';
import {HttpError} from '../http/HttpError.mjs';

// Counts describe the result of clicking each tab: preserve ordinary filters,
// but clear the workload/metric drill-down just as the tab handler does.
export function countDispatchTaskStatuses(tasks,actor,query={}) {
  return {...(query.search||query.includeCompleted==='true'?{all:filterDispatchTasks(tasks,actor,{...query,stage:undefined,includeCompleted:'true',metric:undefined,workloadState:undefined}).length}:{}),...Object.fromEntries(['','待派工','待客户确认','待定','待接单','待开工','维修中','暂停','待检验','回审','草稿','待客户签字','已完成']
    .map(stage=>[stage,filterDispatchTasks(tasks,actor,{...query,stage,includeCompleted:undefined,metric:undefined,workloadState:undefined}).length]))};
}

export function filterDispatchTasks(tasks, actor, query={}) {
  const personal=query.personal==='true';
  if(personal&&(!actor.id||!hasAnyRole(actor,['technician','outsourcing'])&&!actor.outsourcingRoleMember||query.technicianId&&query.technicianId!==actor.id))throw new HttpError(403,'仅可查看本人维修任务');
  if(personal&&(query.partsStatus||query.workloadState))throw new HttpError(400,'本人维修不能使用仓管或负荷筛选');
  const range=completionRange(query.from,query.to);
  const executionModes=query.executionMode?query.executionMode.split(','):[];
  if(executionModes.some(mode=>!['internal','field','outsourced'].includes(mode))) throw new HttpError(400,'执行方式筛选无效');
  let workloadOrders;
  if(query.workloadState){
    if(!['working','waiting','paused','inspection','unfinished'].includes(query.workloadState)||!query.technicianId)throw new HttpError(400,'维修工项目状态筛选无效');
    // Reuse the chart's per-project classification, including personal pauses and mixed-team inspection.
    workloadOrders=new Set(buildOperationsDashboard(tasks,[]).projects.filter(p=>p.ownerId===query.technicianId&&p.flags.includes(query.workloadState)).map(p=>p.orderId));
  }
  return tasks.filter(original=> {
    if(personal&&!technicianIds(original).includes(actor.id))return false;
    let t=original;
    if(personal&&isIndividualRepair(original)) {
      const own=original.items.filter(item=>item.responsibleId===actor.id);
      const stage=personalRepairStage(original,actor.id);
      const completedAt=stage==='维修完成'&&own.length&&own.every(item=>item.status==='已完工')
        ?own.map(item=>item.inspectedAt).filter(Boolean).sort().at(-1)||original.completedAt:original.completedAt;
      t={...original,stage,items:own,completedAt};
    }
    if(workloadOrders&&!workloadOrders.has(t.orderId))return false;
    if(!workloadOrders && query.technicianId && !technicianIds(t).includes(query.technicianId)) return false;
    if(executionModes.length && !executionModes.includes(t.executionMode||'internal')) return false;
    if(query.stage==='进行中' && !['待开工','维修中','暂停'].includes(t.stage)) return false;
    if(query.stage==='已完成') { if(!isRepairCompleted(t.stage,t.orderStatus))return false; }
    else if(query.stage==='完成') { if(t.orderStatus!=='完成' || hasActiveRepairRound(t)) return false; }
    else if(query.stage==='待结算') { if(t.orderStatus!=='待结算' || hasActiveRepairRound(t)) return false; }
    else if(query.stage==='待定') {if(!t.inspectionDeferredCount)return false;}
    else if(query.stage==='待客户确认') {if(!t.pendingRepairCount) return false;}
    else if(query.stage==='待检验') {if(!hasPendingInspection(t)||personal&&t.stage!=='待检验')return false;}
    else if(query.stage && query.stage!=='进行中' && t.stage!==query.stage) return false;
    if(query.urgent==='true' && !t.urgent) return false;
    if(query.overdue==='true' && !t.overdue) return false;
    if(query.search && ![t.orderId,t.dispatchNo,t.plate].some(v=>v.toLowerCase().includes(query.search.toLowerCase()))) return false;
    if(workloadOrders)return true;
    if(!personal&&hasRole(actor, 'warehouse')&&!hasAnyRole(actor,['manager','advisor','inspector'])) return true;
    if(query.includeCompleted!=='true' && isRepairCompleted(t.stage,t.orderStatus) && !['已完成','完成','维修完成','待结算','待客户确认','待定'].includes(query.stage) && query.metric!=='completed') return false;
    if(query.metric) return dispatchMetric(t,query.metric,range.from,range.to);
    // The unified completed view includes all dates unless a date range is chosen.
    if(query.stage==='已完成')return !t.completedAt||(!query.from&&!query.to)||dispatchMetric(t,'completed',range.from,range.to);
    if(['完成','维修完成'].includes(query.stage)) return !t.completedAt || dispatchMetric(t,'completed',range.from,range.to);
    return query.includeCompleted==='true' || ['待客户确认','待定'].includes(query.stage) || t.orderStatus!=='完成' || hasActiveRepairRound(t);
  });
}
