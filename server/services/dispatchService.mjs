import {hasPendingInspection} from '../../shared/repairProgress.mjs';
import { readPendingRepairs } from '../repositories/pendingRepairsRepository.mjs';
import { inspectionReturnStats } from '../domain/inspectionReturnStats.mjs';
import { listInspectionReturns } from '../repositories/inspectionReturnRepository.mjs';
import { hasRole, hasAnyRole } from "../../shared/roles.mjs";
import {actionParts,individualRepair} from '../domain/individualRepair.mjs';
import {enqueueRepairWriteback} from '../repositories/repairWritebackRepository.mjs';
import {wakeRepairWriteback} from '../workers/repairWritebackWorker.mjs';
import { assertPartsPhotos } from '../repositories/partsRequirementRepository.mjs';
import { repairCatalog,saveRepairRound } from '../repositories/repairRoundRepository.mjs';
import { hasActiveRepairRound } from '../domain/repairRounds.mjs';
import { markDispatchPlan } from '../repositories/dispatchPlanRepository.mjs';
import { randomUUID } from 'node:crypto';
import { transaction } from '../database/pool.mjs';
import { HttpError } from '../http/HttpError.mjs';
import { applyDispatchAction, technicianIds, validateDispatchRequest, dispatchMetric, completionRange } from '../domain/dispatchPolicy.mjs';
import { getDispatchTask, saveDispatchTask, dispatchPeople, dispatchDetail, listDispatchTasks, assertRepairPhotoRecorded } from '../repositories/dispatchRepository.mjs';
export { dispatchPeople, dispatchDetail };
export const metricKeys=['pendingAccept','unstarted','working','paused','inspection','completed','overdue','rework'];
export async function queryDispatchTasks(actor, query={}) {
  const range=completionRange(query.from,query.to);
  const executionModes=query.executionMode?query.executionMode.split(','):[];
  if(executionModes.some(mode=>!['internal','field','outsourced'].includes(mode))) throw new HttpError(400,'执行方式筛选无效');
  const tasks=await listDispatchTasks(actor);
  return tasks.filter(t=> {
    if(query.technicianId && !technicianIds(t).includes(query.technicianId)) return false;
    if(executionModes.length && !executionModes.includes(t.executionMode||'internal')) return false;
    if(query.stage==='进行中' && !['待开工','维修中','暂停'].includes(t.stage)) return false;
    if(query.stage==='完成') { if(t.orderStatus!=='完成' || hasActiveRepairRound(t)) return false; }
    else if(query.stage==='待结算') { if(t.orderStatus!=='待结算' || hasActiveRepairRound(t)) return false; }
    else if(query.stage==='待客户确认') {if(!t.pendingRepairCount) return false;}
    else if(query.stage==='待检验') {if(!hasPendingInspection(t))return false;}
    else if(query.stage && query.stage!=='进行中' && t.stage!==query.stage) return false;
    if(query.urgent==='true' && !t.urgent) return false;
    if(query.overdue==='true' && !t.overdue) return false;
    if(query.search && ![t.orderId,t.dispatchNo,t.plate].some(v=>v.toLowerCase().includes(query.search.toLowerCase()))) return false;
    if(hasRole(actor, 'warehouse')) return true;
    if(t.orderStatus==='完成' && !hasActiveRepairRound(t) && !['完成','维修完成','待客户确认'].includes(query.stage) && query.metric!=='completed') return false;
    if(query.metric) return dispatchMetric(t,query.metric,range.from,range.to);
    // Only an explicit historical view includes closed orders. Unsettled repairs
    // stay visible regardless of completion date, including undated legacy orders.
    if(['完成','维修完成'].includes(query.stage)) return !t.completedAt || dispatchMetric(t,'completed',range.from,range.to);
    return query.stage==='待客户确认' || t.orderStatus!=='完成' || hasActiveRepairRound(t);
  });
}
export async function myRepairCounts(actor) {
  if(!hasAnyRole(actor, ['technician','outsourcing'])&&!actor.outsourcingRoleMember) throw new HttpError(403,'仅维修工可查看本人任务数量');
  const tasks=(await listDispatchTasks(actor)).filter(task=>technicianIds(task).includes(actor.id));
  const range=completionRange();
  return {
    pendingAccept:tasks.filter(t=>t.stage==='待接单').length,
    inProgress:tasks.filter(t=>['待开工','维修中','暂停'].includes(t.stage)).length,
    inspection:tasks.filter(t=>hasPendingInspection(t)).length,
    review:tasks.filter(t=>t.stage==='回审').length,
    completed:tasks.filter(t=>t.stage==='维修完成' && (!t.completedAt || dispatchMetric(t,'completed',range.from,range.to))).length
  };
}
export async function technicianSummaries(actor,query={}) {
  if(!hasAnyRole(actor, ['manager','advisor','inspector'])) throw new HttpError(403,'无权查看维修工负荷');
  const range=completionRange(query.from,query.to);
  const tasks=await listDispatchTasks(actor); const people=await dispatchPeople(actor);
  const returns = inspectionReturnStats(await listInspectionReturns(actor.shopId, range));
  return people.filter(p=>hasRole(p, 'technician') || returns.has(p.id) || tasks.some(t=>technicianIds(t).includes(p.id))).map(p=> {
    const own=tasks.filter(t=>technicianIds(t).includes(p.id));
    return {id:p.id,name:p.name,active:p.active,...(returns.get(p.id) || {returnedItemCount:0,returnedItemOccurrences:0}),current:own.filter(t=>t.stage!=='维修完成').length,
      ...Object.fromEntries(metricKeys.map(k=>[k,own.filter(t=>dispatchMetric(t,k,range.from,range.to)).length]))};
  });
}
export async function executeDispatchAction(actor,id,raw,runTransaction=transaction) {
  const input=validateDispatchRequest(raw);
  await runTransaction(client=>executeDispatchActionInTransaction(client,actor,id,input));
  wakeRepairWriteback();
  return dispatchDetail(actor,id);
}
export async function executeDispatchActionInTransaction(client,actor,id,raw,pendingRepair) {
    const input=validateDispatchRequest(raw);
    const task=await getDispatchTask(client,id,actor,true);
    const previous=await client.query('select request_body from dispatch_events where order_id=$1 and actor_id=$2 and request_id=$3',[id,actor.id,input.requestId]);
    if(previous.rows[0]) {
      // JSONB normalizes key order. Compare canonical values rather than raw serialization.
      const normalize=value=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,normalize(item)])):value;
      const canonical=value=>JSON.stringify(normalize(value));
      if(canonical(previous.rows[0].request_body)!==canonical(input)) throw new HttpError(409,'请求编号已用于其他操作');
      return;
    }
    await client.query('select id from users where shop_id=$1 order by id for share',[actor.shopId]);
    const people=await dispatchPeople(actor,client);
    const currentActor=people.find(p=>p.id===actor.id);
    if(!currentActor?.active || currentActor.role!==actor.role) throw new HttpError(403,'当前员工权限已变化，请重新登录');
    if(input.action==='retry-inspection-notifications') {
      const {rows:jobs}=await client.query('select status,error from dispatch_inspection_notifications where order_id=$1 order by event_id desc limit 1',[id]);
      if(task.inspectorId || !jobs[0]?.error || jobs[0].status==='ready') throw new HttpError(409,'当前无需重试检验员通知');
    }
    if(input.action==='reopen-repair'||input.action==='edit-repair-items'||input.repairItems!==undefined) task.repairCatalog=await repairCatalog(client,task);
    const next=applyDispatchAction(task,input,currentActor,people);
    if(input.repairItems) {
      const pending=await readPendingRepairs(client,id);
      if(pending.items.some(p=>p.scheduled&&task.items.some(i=>i.id===p.itemId)&&!next.items.some(i=>i.id===p.itemId)))throw new HttpError(409,'已安排的客户确认项目不能直接删除，请保留项目及确认记录');
    }

    if(pendingRepair) {
      const added=next.items.find(i=>!task.items.some(old=>old.id===i.id));
      if(!added)throw new HttpError(409,'追加项目生成失败');
      added.id=pendingRepair.itemId;
      if(pendingRepair.additional){next.roundKind='additional';next.rework=false;}
      if(!pendingRepair.additional&&task.stage!=='待派工'&&task.executionMode!=='outsourced'&&!people.some(p=>p.id===added.responsibleId&&p.active&&hasRole(p,'technician')))throw new HttpError(400,'请选择本店有效维修工');
      next.repairItemIdFloor=Math.min(next.repairItemIdFloor||0,added.id);
    }

    if(['submit-review','submit-order','submit'].includes(input.action)) await assertRepairPhotoRecorded(client,task,individualRepair(task)?actor.id:undefined);
    const parts=actionParts(next,input,actor);
    const preparationGroups=input.preparationGroups?.map(group=>({...group,partsRequirement:actionParts(next,{partsOwnerId:group.partsOwnerId},actor)}));
    const preparedForRecipient=recipient=>preparationGroups?.map(group=>({...group,items:group.items.filter(item=>item.recipientId===recipient)})).filter(group=>group.items.length);
    if(['accept','record-parts','edit-parts'].includes(input.action))await assertPartsPhotos(client,task,parts,input.action==='edit-parts'?undefined:actor.id);
    if(input.action!=='update-technicians') await saveRepairRound(client,task,next,currentActor,input.action);
    await saveDispatchTask(client,next,{metadataOnly:input.action==='update-due',techniciansOnly:input.action==='update-technicians'});
    if(input.action==='assign') await markDispatchPlan(client,id);
    const detail={preparationGroups,partsPreparation:input.partsPreparation,partsIssue:input.partsIssue,reassignItemIds:input.reassignItemIds,previousItems:input.repairItems||['send-review','reassign','inspect'].includes(input.action)?task.items:undefined,partsRequirement:parts,roundKind:next.roundKind,repairRound:next.repairRound,items:next.items,reworkItemIds:input.reworkItemIds,additionalItems:input.additionalItems,workHours:next.workHours,previousWorkHours:task.workHours,executionMode:next.executionMode,contractor:next.contractor,outsourcingMode:next.outsourcingMode,stage:next.stage,note:input.note,reason:input.reason,pauseReason:input.pauseReason,itemId:input.itemId,rejectedItemIds:input.rejectedItemIds,
      technicianName:next.technicianName,previousTechnicianName:task.technicianName,inspectorName:next.inspectorName,dueAt:next.dueAt,urgent:next.urgent,previousDueAt:task.dueAt};
    const {rows:[event]}=await client.query(`insert into dispatch_events(order_id,actor_id,actor_name,request_id,request_body,action,detail) values($1,$2,$3,$4,$5,$6,$7) returning id`,[id,actor.id,actor.name,input.requestId,JSON.stringify(input),input.action,JSON.stringify(detail)]);
    if(input.action==='inspect'&&next.stage==='维修完成')await enqueueRepairWriteback(client,next,event.id);
    await client.query('insert into audit_logs(order_id,actor,action) values($1,$2,$3)',[id,actor.name,`派工：${input.action}${input.reason?` · ${input.reason}`:''}`]);
    if(input.action==='retry-scheduler-notifications') {
      if(!input.notificationJobId) throw new HttpError(400,'请选择派工通知任务');
      const result=await client.query(`update dispatch_scheduler_notifications set status='pending',error='',attempts=0,next_attempt_at=now(),locked_until=null,lease_id=null,updated_at=now()
        where event_id::text=$1 and order_id=$2 and error<>'' and status in ('pending','failed') and (locked_until is null or locked_until<now()) returning event_id`,[input.notificationJobId,id]);
      if(!result.rowCount) throw new HttpError(409,'该通知任务无需重试或正在处理中');
      return;
    }
    if(input.action==='retry-notification') {
      if(!input.notificationId) throw new HttpError(400,'请选择通知');
      const result=await client.query(`update dispatch_notifications set status='pending',error='',attempts=0,polls=0,task_id=null,next_attempt_at=now(),updated_at=now(),locked_until=null,lease_id=null
        where id::text=$1 and order_id=$2 and status='failed' and (locked_until is null or locked_until<now()) returning id`,[input.notificationId,id]);
      if(!result.rowCount) throw new HttpError(409,'仅明确失败的通知可重新发送；结果未知时请先核对钉钉记录');
      return;
    }
    const recipients=[];
    const add=(recipient,kind)=>{ if(recipient) recipients.push({recipient,kind}); };
    const handlers=t=>t.executionMode==='outsourced' && !technicianIds(t).length ? people.filter(p=>p.active && hasAnyRole(p, ['manager','advisor'])).map(p=>p.id) : technicianIds(t);
    const addHandlers=(t,kind)=>handlers(t).forEach(id=>add(id,kind));
    const removedProjects=input.repairItems?task.items.filter(item=>!next.items.some(current=>current.id===item.id)):[];
    const removedFor=recipient=>removedProjects.filter(item=>item.responsibleId?item.responsibleId===recipient:technicianIds(task).includes(recipient));
    const removedRecipients=new Set(removedProjects.flatMap(item=>item.responsibleId?[item.responsibleId]:technicianIds(task)));
    removedRecipients.forEach(recipient=>add(recipient,'维修项目已删除'));
    const addedProjects=input.action==='edit-repair-items'?next.items.filter(item=>!task.items.some(previous=>previous.id===item.id)):[];
    const addedFor=recipient=>addedProjects.filter(item=>item.responsibleId?item.responsibleId===recipient:handlers(next).includes(recipient));
    if(task.stage!=='待派工') {
      const addedRecipients=new Set(addedProjects.flatMap(item=>item.responsibleId?[item.responsibleId]:handlers(next)));
      addedRecipients.forEach(recipient=>add(recipient,'新增维修项目'));
    }
    const changedProjectIds=input.reassignItemIds??(input.action==='edit-repair-items'?next.items.filter(item=>{
      const previous=task.items.find(previous=>previous.id===item.id);
      return previous&&item.responsibleId&&item.responsibleId!==previous.responsibleId;
    }).map(item=>item.id):[]);
    const projectReassignment=changedProjectIds.length>0;
    if(projectReassignment) {
      const affected=new Set([...task.items,...next.items].filter(i=>changedProjectIds.includes(i.id)).map(i=>i.responsibleId).filter(Boolean));
      affected.forEach(id=>add(id,'项目改派'));
    } else {
      if(['assign','reassign','reoffer','reconcile','reopen-repair'].includes(input.action) && next.stage!=='维修完成') addHandlers(next,input.action==='reopen-repair'?(next.roundKind==='additional'?'追加维修派工':'返工派工'):'新派工');
      if(['reassign','cancel'].includes(input.action)) addHandlers(task,input.action==='cancel'?'派工已撤销':'任务已改派');
    }
    const schedulerKind={decline:'无法接单',pause:'维修暂停','submit-review':'回审已提交','submit-order':'维修已提检',submit:'维修已提检'}[input.action];
    if(schedulerKind && (!['submit-order','submit-review'].includes(input.action)||hasPendingInspection(next))) {
      const payload={orderId:id,plate:next.plate,dispatchNo:next.dispatchNo,summary:next.items.map(i=>i.name).join('、').slice(0,200),dueAt:next.dueAt,actorName:actor.name,reason:input.action==='pause'?[input.pauseReason,input.note].filter(Boolean).join('：'):input.reason||input.note||''};
      await client.query('insert into dispatch_scheduler_notifications(event_id,order_id,kind,payload) values($1,$2,$3,$4)',[event.id,id,schedulerKind,JSON.stringify(payload)]);
    }
    if(['submit-review','submit-order','retry-inspection-notifications'].includes(input.action)&&hasPendingInspection(next)) {
      await client.query(`insert into dispatch_inspection_notifications(event_id,order_id) values($1,$2) on conflict do nothing`,[event.id,id]);
    }
    if(['accept','record-parts'].includes(input.action) && parts?.mode!=='none'&&!parts?.preparedAt&&!parts?.issuedAt) people.filter(p=>p.active && hasRole(p, 'warehouse')).forEach(p=>add(p.id,'配件申请'));
    const addPartsHandlers=kind=>parts?.ownerId?add(parts.ownerId,kind):addHandlers(next,kind);
    if(input.action==='edit-parts') addPartsHandlers('配件需求已调整');
    if(input.action==='accept'&&parts?.preparedAt&&!parts?.issuedAt) addPartsHandlers('配件可领取');
    if(input.action==='confirm-parts') {if(input.preparationGroups)[...new Set(input.preparationGroups.flatMap(group=>group.items.map(row=>row.recipientId)))].forEach(id=>add(id,'配件可领取'));else if(input.partsPreparation)[...new Set(input.partsPreparation.map(row=>row.recipientId))].forEach(id=>add(id,'配件可领取'));else addPartsHandlers('配件可领取');}
    if(input.action==='issue-parts') {
      const issuedIds=input.partsIssue?[...new Set(input.partsIssue.map(row=>row.recipientId))]:parts?.recipientIds||[];
      issuedIds.forEach(id=>add(id,'配件已出库'));
    }
    if(input.action==='submit' || input.action==='reassign-inspection') add(next.inspectorId,'待检验');
    if(input.action==='send-review') addHandlers(next,'维修单回审');
    if(input.action==='inspect' && input.rejectedItemIds?.length) {
      const owners=new Set(next.items.filter(item=>input.rejectedItemIds.includes(item.id)).map(item=>item.responsibleId).filter(Boolean));
      owners.forEach(owner=>add(owner,'退回返工'));
    }
    if(['submit-order','submit-review'].includes(input.action)&&hasPendingInspection(next)&&next.inspectorId)add(next.inspectorId,'待检验');
    if(input.action==='remind') {
      const targets=hasPendingInspection(task)?[task.inspectorId]:task.feedback?[task.assignedBy]:handlers(task);
      if(!targets.length) throw new HttpError(409,'没有可催办的处理人');
      for(const recipient of targets) {
      if(!people.some(p=>p.id===recipient && p.active)) throw new HttpError(409,'当前处理人已停用或不存在，请先调整责任人');
      const recent=await client.query("select 1 from dispatch_notifications where order_id=$1 and recipient_id=$2 and kind='人工催办' and created_at>now()-interval '10 minutes' limit 1",[id,recipient]);
      if(recent.rowCount) throw new HttpError(429,'同一任务对同一人十分钟内只能催办一次');
      add(recipient,'人工催办');
      }
    }
    for(const {recipient,kind} of recipients) await client.query(`insert into dispatch_notifications(id,order_id,event_id,recipient_id,kind,payload) values($1,$2,$3,$4,$5,$6) on conflict(event_id,recipient_id,kind) do nothing`,[randomUUID(),id,event.id,recipient,kind,JSON.stringify({shopId:next.shopId,repairRound:next.repairRound||0,orderId:id,plate:next.plate,dispatchNo:next.dispatchNo,actorName:actor.name,itemIds:kind==='新增维修项目'?addedFor(recipient).map(i=>i.id):kind==='追加维修派工'?next.items.filter(i=>!i.responsibleId||i.responsibleId===recipient).map(i=>i.id):undefined,summary:(kind==='配件可领取'&&preparationGroups?preparedForRecipient(recipient).flatMap(group=>group.items.map(row=>{const item=group.partsRequirement.items[row.index];return `${item.name} ${item.quantity}${item.unit}`;})):kind==='配件可领取'&&input.partsPreparation?input.partsPreparation.filter(row=>row.recipientId===recipient).map(row=>{const item=parts.items[row.index];return `${item.name} ${item.quantity}${item.unit}`;}):kind==='配件已出库'&&input.partsIssue?input.partsIssue.filter(row=>row.recipientId===recipient).map(row=>{const item=parts.items[row.index];return `${item.name} ${item.quantity}${item.unit}`;}):kind==='维修项目已删除'?removedFor(recipient).map(i=>i.name):kind==='新增维修项目'?addedFor(recipient).map(i=>i.name):kind==='项目改派'?next.items.filter(i=>changedProjectIds.includes(i.id)&&(i.responsibleId===recipient||task.items.some(old=>old.id===i.id&&old.responsibleId===recipient))).map(i=>`${i.name} → ${i.responsibleName}`):next.items.map(i=>i.name)).join('、').slice(0,200),dueAt:next.dueAt,preparationGroups:preparedForRecipient(recipient)?.map(group=>({partsOwnerId:group.partsOwnerId,partsRecordedAt:group.partsRequirement.recordedAt,partsRevision:group.partsRequirement.revision,items:group.items.map(row=>({index:row.index,preparedAt:group.partsRequirement.items[row.index].preparedAt}))})),partsPreparation:input.partsPreparation?.filter(row=>row.recipientId===recipient).map(row=>({index:row.index,preparedAt:parts.items[row.index].preparedAt})),partsOwnerId:parts?.ownerId,partsRecordedAt:parts?.recordedAt,partsRevision:parts?.revision,notice:input.action==='send-review'?'维修单已进入回审，请重新核对并编辑本人维修项目后提交回审。':kind==='维修项目已删除'?'所列维修项目已删除，无需继续施工；其他项目按原安排执行。':kind==='新增维修项目'?'所列项目已新增，请查看并安排施工。':kind==='追加维修派工'?'客户已确认追加维修，请接单处理。':kind==='项目改派'?'仅所列项目变更负责人，其他项目及工单进度保持不变。':input.action==='edit-parts'?'仓管已整理配件需求，请查看最新清单。':input.action==='confirm-parts'?'本次所列配件已备齐，请到仓库领取；其他未通知配件仍在备料。':input.action==='issue-parts'?(parts?.issuedAt?'本批配件已全部交接出库，请查看本人领料明细。':'本次所列配件已交接出库，其余配件继续待处理。'):'',reason:input.reason||(input.action==='send-review'?input.note:'')||''})]);
}
