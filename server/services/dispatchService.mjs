import { markDispatchPlan } from '../repositories/dispatchPlanRepository.mjs';
import { randomUUID } from 'node:crypto';
import { transaction } from '../database/pool.mjs';
import { HttpError } from '../http/HttpError.mjs';
import { applyDispatchAction, technicianIds, validateDispatchRequest, dispatchMetric, completionRange } from '../domain/dispatchPolicy.mjs';
import { getDispatchTask, saveDispatchTask, dispatchPeople, dispatchDetail, listDispatchTasks } from '../repositories/dispatchRepository.mjs';
export { dispatchPeople, dispatchDetail };
export const metricKeys=['pendingAccept','unstarted','working','paused','inspection','completed','overdue','rework'];
export async function queryDispatchTasks(actor, query={}) {
  const range=completionRange(query.from,query.to);
  const tasks=await listDispatchTasks(actor);
  return tasks.filter(t=> {
    if(query.technicianId && !technicianIds(t).includes(query.technicianId)) return false;
    if(query.executionMode && (t.executionMode||'internal')!==query.executionMode) return false;
    if(query.stage==='完成') { if(t.orderStatus!=='完成') return false; }
    else if(query.stage==='待结算') { if(t.orderStatus!=='待结算') return false; }
    else if(query.stage && t.stage!==query.stage) return false;
    if(query.urgent==='true' && !t.urgent) return false;
    if(query.overdue==='true' && !t.overdue) return false;
    if(query.search && ![t.orderId,t.dispatchNo,t.plate].some(v=>v.toLowerCase().includes(query.search.toLowerCase()))) return false;
    if(t.orderStatus==='完成' && !['完成','维修完成'].includes(query.stage) && query.metric!=='completed') return false;
    if(query.metric) return dispatchMetric(t,query.metric,range.from,range.to);
    // Only an explicit historical view includes closed orders. Unsettled repairs
    // stay visible regardless of completion date, including undated legacy orders.
    if(['完成','维修完成'].includes(query.stage)) return !t.completedAt || dispatchMetric(t,'completed',range.from,range.to);
    return t.orderStatus!=='完成';
  });
}
export async function technicianSummaries(actor,query={}) {
  if(!['manager','advisor'].includes(actor.role)) throw new HttpError(403,'无权查看维修工负荷');
  const range=completionRange(query.from,query.to);
  const tasks=await listDispatchTasks(actor); const people=await dispatchPeople(actor);
  return people.filter(p=>p.role==='technician' || tasks.some(t=>technicianIds(t).includes(p.id))).map(p=> {
    const own=tasks.filter(t=>technicianIds(t).includes(p.id));
    return {id:p.id,name:p.name,active:p.active,current:own.filter(t=>t.stage!=='维修完成').length,
      ...Object.fromEntries(metricKeys.map(k=>[k,own.filter(t=>dispatchMetric(t,k,range.from,range.to)).length]))};
  });
}
export async function executeDispatchAction(actor,id,raw,runTransaction=transaction) {
  const input=validateDispatchRequest(raw);
  await runTransaction(client=>executeDispatchActionInTransaction(client,actor,id,input));
  return dispatchDetail(actor,id);
}
export async function executeDispatchActionInTransaction(client,actor,id,raw) {
    const input=validateDispatchRequest(raw);
    const task=await getDispatchTask(client,id,actor,true);
    const previous=await client.query('select request_body from dispatch_events where order_id=$1 and actor_id=$2 and request_id=$3',[id,actor.id,input.requestId]);
    if(previous.rows[0]) {
      // JSONB normalizes key order. Compare canonical values rather than raw serialization.
      const canonical=o=>JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a],[b])=>a.localeCompare(b))));
      if(canonical(previous.rows[0].request_body)!==canonical(input)) throw new HttpError(409,'请求编号已用于其他操作');
      return;
    }
    const people=await dispatchPeople(actor,client);
    const currentActor=people.find(p=>p.id===actor.id);
    if(!currentActor?.active || currentActor.role!==actor.role) throw new HttpError(403,'当前员工权限已变化，请重新登录');
    const next=applyDispatchAction(task,input,currentActor,people);
    await saveDispatchTask(client,next);
    if(input.action==='assign') await markDispatchPlan(client,id);
    const detail={workHours:next.workHours,previousWorkHours:task.workHours,executionMode:next.executionMode,contractor:next.contractor,outsourcingMode:next.outsourcingMode,stage:next.stage,note:input.note,reason:input.reason,pauseReason:input.pauseReason,itemId:input.itemId,rejectedItemIds:input.rejectedItemIds,
      technicianName:next.technicianName,previousTechnicianName:task.technicianName,inspectorName:next.inspectorName,dueAt:next.dueAt,urgent:next.urgent,previousDueAt:task.dueAt};
    const {rows:[event]}=await client.query(`insert into dispatch_events(order_id,actor_id,actor_name,request_id,request_body,action,detail) values($1,$2,$3,$4,$5,$6,$7) returning id`,[id,actor.id,actor.name,input.requestId,JSON.stringify(input),input.action,JSON.stringify(detail)]);
    await client.query('insert into audit_logs(order_id,actor,action) values($1,$2,$3)',[id,actor.name,`派工：${input.action}${input.reason?` · ${input.reason}`:''}`]);
    if(input.action==='retry-notification') {
      if(!input.notificationId) throw new HttpError(400,'请选择通知');
      const result=await client.query(`update dispatch_notifications set status='pending',error='',attempts=0,polls=0,task_id=null,next_attempt_at=now(),updated_at=now(),locked_until=null,lease_id=null
        where id::text=$1 and order_id=$2 and status='failed' and (locked_until is null or locked_until<now()) returning id`,[input.notificationId,id]);
      if(!result.rowCount) throw new HttpError(409,'仅明确失败的通知可重新发送；结果未知时请先核对钉钉记录');
      return;
    }
    const recipients=[];
    const add=(recipient,kind)=>{ if(recipient) recipients.push({recipient,kind}); };
    const handlers=t=>t.executionMode==='outsourced' ? people.filter(p=>p.active && ['manager','advisor'].includes(p.role)).map(p=>p.id) : technicianIds(t);
    const addHandlers=(t,kind)=>handlers(t).forEach(id=>add(id,kind));
    if(['assign','reassign','reoffer','reconcile'].includes(input.action) && next.stage!=='维修完成') addHandlers(next,'新派工');
    if(['reassign','cancel'].includes(input.action)) addHandlers(task,input.action==='cancel'?'派工已撤销':'任务已改派');
    if(input.action==='decline') {
      const scheduler=people.find(p=>p.id===task.assignedBy && p.active && ['manager','advisor'].includes(p.role));
      if(scheduler) add(scheduler.id,'无法接单'); else people.filter(p=>p.active && p.role==='manager').forEach(p=>add(p.id,'无法接单'));
    }
    if(input.action==='submit') add(next.inspectorId,'待检验');
    if(input.action==='inspect' && next.stage==='维修中') addHandlers(next,'退回返工');
    if(input.action==='remind') {
      const targets=task.stage==='待检验'?[task.inspectorId]:task.feedback?[task.assignedBy]:handlers(task);
      if(!targets.length) throw new HttpError(409,'没有可催办的处理人');
      for(const recipient of targets) {
      if(!people.some(p=>p.id===recipient && p.active)) throw new HttpError(409,'当前处理人已停用或不存在，请先调整责任人');
      const recent=await client.query("select 1 from dispatch_notifications where order_id=$1 and recipient_id=$2 and kind='人工催办' and created_at>now()-interval '10 minutes' limit 1",[id,recipient]);
      if(recent.rowCount) throw new HttpError(429,'同一任务对同一人十分钟内只能催办一次');
      add(recipient,'人工催办');
      }
    }
    for(const {recipient,kind} of recipients) await client.query(`insert into dispatch_notifications(id,order_id,event_id,recipient_id,kind,payload) values($1,$2,$3,$4,$5,$6) on conflict(event_id,recipient_id,kind) do nothing`,[randomUUID(),id,event.id,recipient,kind,JSON.stringify({orderId:id,plate:next.plate,dispatchNo:next.dispatchNo,summary:next.items.map(i=>i.name).join('、').slice(0,200),dueAt:next.dueAt,reason:input.reason||''})]);
}
