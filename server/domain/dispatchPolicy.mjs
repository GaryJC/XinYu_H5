import {prepareSettlementAssignment} from './settlementAssignment.mjs';
import {hasPendingInspection,allWorkersHaveItems} from '../../shared/repairProgress.mjs';
import {canEditDispatchTechnicians,requiredDispatchTechnicians} from '../../shared/dispatchTechniciansPolicy.mjs';
import { canEditDispatchDue } from '../../shared/dispatchDuePolicy.mjs';
import { hasRole, hasAnyRole } from "../../shared/roles.mjs";
import {validatePartsIssue,issueParts,prepareParts} from './partsIssue.mjs';
import {applyIndividualAction} from './individualRepair.mjs';
import {resolveRepairResponsibilities,transferUnfinishedResponsibilities} from './repairResponsibilities.mjs';
import {validateProjectReassignment,reassignProjects} from './projectReassignment.mjs';
import {validateRepairItemEdits,editRepairItems} from './repairItemEditing.mjs';
import { validatePartsRequirement,beginPendingItems,assertPartsIssued } from './partsRequirement.mjs';
import { reopenRepairTask,validateReopenItems } from './repairRounds.mjs';
import { sendReview } from './repairReview.mjs';
import { HttpError } from '../http/HttpError.mjs';
export const DISPATCH_ROLES = ['manager','advisor','technician','inspector','warehouse','outsourcing'];
export const technicianIds = task => task.technicianIds ?? (task.technicianId ? [task.technicianId] : []);
export const canInspect = (task, actor) => actor?.active && (hasRole(actor, 'manager')||actor.inspectorRoleMember!==false) && hasAnyRole(actor, ['inspector','manager']) && actor.shopId===task.shopId && !technicianIds(task).includes(actor.id) && !(task.participantIds||[]).includes(actor.id) && !task.items.some(i=>i.responsibleId===actor.id || i.startedBy===actor.id || i.finishedBy===actor.id);
const scheduling = ['manager','advisor'];
const fail = (message, status = 409) => { throw new HttpError(status, message); };
export function assertDispatchAccess(task, actor) {
  if (!actor?.active || !hasAnyRole(actor, DISPATCH_ROLES) || task.shopId !== actor.shopId) fail('无权访问该门店任务',403);
  if (hasAnyRole(actor, [...scheduling, 'inspector'])) return;
  if (['草稿','待客户签字','待处理纸质委托书'].includes(task.orderStatus)) fail('客户尚未签字，无权访问该维修任务',403);
  if (hasRole(actor, 'warehouse') && (task.partsRequirement || task.partsRequests?.length || task.hasPartsHistory)) return;
  if ((hasAnyRole(actor, ['technician','outsourcing'])||actor.outsourcingRoleMember) && technicianIds(task).includes(actor.id)) return;
  fail('任务已改派或不属于当前员工',403);
}
export function validateDispatchRequest(input) {
  validatePartsIssue(input||{});
  validateReopenItems(input||{});
  validateRepairItemEdits(input||{});
  validateProjectReassignment(input||{});
  const actions = ['update-technicians','update-due','send-review','submit-review','edit-repair-items','edit-parts','issue-parts','confirm-parts','record-parts','reopen-repair','start-order','submit-order','claim-inspection','reassign-inspection','retry-inspection-notifications','retry-scheduler-notifications','record-hours','assign','reassign','reoffer','cancel','accept','decline','start','finish','pick','pause','resume','submit','inspect','update','remind','retry-notification','reconcile'];
  if (!input || !actions.includes(input.action) || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId)) fail('操作参数无效：需要版本号及唯一请求编号',400);
  for (const key of ['note','reason','pauseReason','technicianId','inspectorId','notificationId','notificationJobId']) {
    if (input[key] !== undefined && (typeof input[key] !== 'string' || input[key].length > 2000)) fail('文本参数无效',400);
  }
  if (input.technicianIds !== undefined && (!Array.isArray(input.technicianIds) || input.technicianIds.length>100 || input.technicianIds.some(id=>typeof id!=='string' || !id || id.length>200) || new Set(input.technicianIds).size!==input.technicianIds.length)) fail('维修员工名单无效',400);
  if(input.workHours!==undefined && (typeof input.workHours!=='number' || !Number.isFinite(input.workHours) || input.workHours<=0 || input.workHours>10000 || Math.abs(input.workHours*100-Math.round(input.workHours*100))>0.000001)) fail('工时须大于 0 且不超过 10000 小时，最多两位小数',400);
  if(input.workHours!==undefined && !['inspect','record-hours'].includes(input.action)) fail('请在检验完成时填写工时',400);
  if(input.partsRequirement!==undefined) {if(!['accept','record-parts','edit-parts'].includes(input.action)) fail('配件需求请通过登记入口修改',400);validatePartsRequirement(input.partsRequirement);}
  if(input.partsOwnerId!==undefined&&(typeof input.partsOwnerId!=='string'||!input.partsOwnerId||input.partsOwnerId.length>200||!['accept','record-parts','edit-parts','confirm-parts','issue-parts'].includes(input.action)))fail('领料申请人无效',400);
  validateExecution(input);
  if (input.urgent !== undefined && typeof input.urgent !== 'boolean') fail('加急参数无效',400);
  if (input.itemId !== undefined && !Number.isSafeInteger(input.itemId)) fail('维修项目编号无效',400);
  if (input.rejectedItemIds !== undefined && (!Array.isArray(input.rejectedItemIds) || input.rejectedItemIds.some(id=>!Number.isSafeInteger(id)) || new Set(input.rejectedItemIds).size !== input.rejectedItemIds.length)) fail('退回项目无效',400);
  if (input.dueAt !== undefined && (typeof input.dueAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.dueAt) || !Number.isFinite(Date.parse(input.dueAt)))) fail('预计完工时间必须包含时区',400);
  if (input.action === 'update-due') {
    if (!input.dueAt) fail('请填写预计完工时间',400);
    if (Object.keys(input).some(key => !['action','expectedVersion','requestId','dueAt'].includes(key))) fail('此操作仅可修改预计完工时间',400);
    const calendar = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(input.dueAt);
    if (!calendar || new Date(`${calendar[1]}T00:00:00Z`).toISOString().slice(0,10)!==calendar[1] || +calendar[2]>23 || +calendar[3]>59 || +(calendar[4] || 0)>59) fail('预计完工时间无效',400);
  }
  if(input.action==='update-technicians') {
    if(!input.technicianIds?.length) fail('请至少保留一名维修员工',400);
    if(Object.keys(input).some(key=>!['action','expectedVersion','requestId','technicianIds'].includes(key))) fail('此操作仅可修改维修员工名单',400);
  }
  return input;
}
export function applyDispatchAction(task, input, actor, people, now = new Date().toISOString(), recipientScope, personalEditing=false) {
  validateDispatchRequest(input);
  assertDispatchAccess(task,actor);
  if (['草稿','待客户签字','待处理纸质委托书'].includes(task.orderStatus) || ['草稿','待客户签字','待处理纸质委托书'].includes(task.stage)) fail('客户签字后才能执行派工操作');
  if (task.version !== input.expectedVersion) fail('任务已更新，请刷新后重试');
  if(task.needsReview&&!['reconcile','remind','retry-notification','retry-scheduler-notifications'].includes(input.action))fail('历史任务需要管理员先核对归属和进度');
  if(input.action==='update-technicians') {
    if(!canEditDispatchTechnicians(task,actor)) fail('仅本店服务顾问、管理员或检验员可修改待结算工单的维修员工',403);
    const required=requiredDispatchTechnicians(task);
    const missing=required.filter(id=>!input.technicianIds.includes(id));
    if(missing.length) fail('不能移除已分配维修项目或已有完工提检记录的员工');
    const retained=new Set([...technicianIds(task),...required]);
    for(const id of input.technicianIds) {
      if(!retained.has(id)&&!people.some(person=>person.id===id&&person.active&&person.shopId===task.shopId&&hasRole(person,'technician'))) fail('新增员工须为本店有效维修工',400);
    }
    const names=input.technicianIds.map(id=>people.find(person=>person.id===id)?.name
      || task.items.find(item=>item.responsibleId===id)?.responsibleName || id);
    return {...structuredClone(task),technicianIds:[...input.technicianIds],technicianId:input.technicianIds[0],technicianName:names.join('、'),version:task.version+1};
  }
  if(input.action==='send-review') return sendReview(task,actor,canInspect,people);
  const personalReviewEdit=input.action==='edit-repair-items'&&technicianIds(task).includes(actor.id)&&input.repairItems?.every(row=>task.items.some(item=>item.id===row.id&&item.responsibleId===actor.id)||row.id===undefined&&(!row.responsibleId||row.responsibleId===actor.id));
  if(input.action==='submit-review' || task.stage==='回审'&&['edit-repair-items','start-order'].includes(input.action)&&!(input.action==='edit-repair-items'&&!personalReviewEdit&&!personalEditing&&hasAnyRole(actor,scheduling))) {
    if(task.stage!=='回审') fail('仅回审任务可提交回审');
    const legacyContractorHandler=task.executionMode==='outsourced'&&!task.contractorId&&hasAnyRole(actor,scheduling);
    if(!legacyContractorHandler&&(!technicianIds(task).includes(actor.id)||!hasAnyRole(actor,['technician','outsourcing'])&&!actor.outsourcingRoleMember)) fail('仅当前维修工可编辑或提交回审',403);
    // Review edits stay scoped to the worker even when they also hold scheduling roles.
    const next=applyDispatchAction({...task,stage:'维修中'},{...input,action:input.action==='submit-review'?'submit-order':input.action},actor,people,now,recipientScope,true);
    if(input.action!=='submit-review'||next.stage!=='待检验') next.stage='回审';
    if(input.action==='edit-repair-items') for(const item of next.items) {
      if(!task.items.some(previous=>previous.id===item.id)&&item.status==='待开工') Object.assign(item,{status:'维修中',startAt:now,startedBy:actor.id});
    }
    return next;
  }
  if(input.preparationGroups){
    // Each transition works on a clone. Persist only after every group succeeds.
    let prepared=task;
    for(const group of input.preparationGroups)prepared=applyDispatchAction(prepared,{...input,preparationGroups:undefined,partsOwnerId:group.partsOwnerId,partsPreparation:group.items,expectedVersion:prepared.version},actor,people,now);
    return {...prepared,version:task.version+1};
  }
  const individual=applyIndividualAction(task,input,actor,people,now,(...args)=>applyDispatchAction(...args,personalEditing),{personalEditing});
  if(individual)return individual;
  let next = structuredClone(task);
  if(input.action==='reopen-repair') next=reopenRepairTask(task,input,actor,now);
  const action = input.action;
  if(hasRole(actor, 'warehouse') && !hasAnyRole(actor, ['manager','advisor','technician','inspector']) && !(task.executionMode==='outsourced'&&actor.outsourcingRoleMember&&technicianIds(task).includes(actor.id)) && !['edit-parts','confirm-parts','issue-parts'].includes(action)) fail('仓管仅可整理需求、备料或确认出库',403);
  if((task.repairRound||action==='reopen-repair') && input.agreedFee!=null) fail('返工仅处理维修，不新增约定费用',400);
  const requireSchedule = () => { if(!hasAnyRole(actor, scheduling)) fail('仅服务顾问或管理员可调度任务',403); };
  const requireOwner = () => { if(!(technicianIds(task).includes(actor.id) && (hasAnyRole(actor, ['technician','outsourcing'])||actor.outsourcingRoleMember) || task.executionMode==='outsourced' && hasAnyRole(actor, scheduling))) fail('仅当前维修工可执行此操作',403); };
  const stage = (...stages) => { if (!stages.includes(task.stage)) fail(`当前${task.stage}不能执行该操作`); };
  const reason = () => { if (!input.reason?.trim()) fail('请填写原因或交接说明',400); };
  const person = (id, roles) => { const found = people.find(u=>u.id===id && u.active && u.shopId===task.shopId && hasAnyRole(u, roles)); if(!found) fail('人员不存在、已停用或不属于本店',400); return found; };
  const item = () => { const found = next.items.find(i=>i.id===input.itemId); if(!found) fail('维修项目不存在',404); return found; };
  if (task.stage==='待检验' && task.items.some(i=>!['待检验','已完工'].includes(i.status))) fail('任务与项目进度不一致，请联系管理员');
  if (task.needsReview && !['reconcile','remind','retry-notification','retry-scheduler-notifications'].includes(action)) fail('历史任务需要管理员先核对归属和进度');
  if(action==='reassign'&&input.reassignItemIds!==undefined) {
    requireSchedule();stage('待接单','待开工','维修中','暂停');reason();
    reassignProjects(next,input,people);
    // An accepted team task keeps its progress; new members join that repair team.
    if(input.note!==undefined)next.note=input.note;
  } else if (['assign','reassign','reconcile','reopen-repair'].includes(action)) {
    if(action==='reopen-repair') {if(!hasAnyRole(actor, [...scheduling,'inspector'])) fail('仅检验员、服务顾问或管理员可发起返工',403);}
    else requireSchedule();
    if(action==='reconcile') { if(!hasRole(actor, 'manager') || !task.needsReview) fail('仅管理员可核对历史任务',403); reason(); }
    else if(action==='assign') stage('待派工'); else if(action==='reopen-repair') stage('维修完成'); else { stage('待接单','待开工','维修中','暂停'); reason(); }
    const mode=input.executionMode ?? task.executionMode ?? 'internal';
    const ids=mode==='outsourced'?(input.contractorId?[input.contractorId]:[]):(input.technicianIds ?? (input.technicianId?[input.technicianId]:[]));
    if(mode!=='outsourced' && !ids.length) fail('请选择维修员工',400);
    if(mode==='outsourced') {
      const contractor=people.find(p=>p.id===input.contractorId && p.active && p.shopId===task.shopId && (hasRole(p, 'outsourcing')||p.outsourcingRoleMember));
      if(!contractor) fail('请选择本店有效的外包人员作为承包方',400);
      input={...input,contractor:contractor.name};
    }
    const workers=mode==='outsourced'?ids.map(id=>people.find(p=>p.id===id)):ids.map(id=>person(id,['technician']));
    const worker={id:workers[0]?.id,name:workers.map(p=>p.name).join('、') || input.contractor || task.contractor};
    const execution=executionDetails({...next,...input,executionMode:mode});
    if(action==='reassign' && mode===(task.executionMode||'internal') && [...ids].sort().join() === [...technicianIds(task)].sort().join() && (mode!=='outsourced' || execution.contractor===task.contractor && execution.outsourcingMode===task.outsourcingMode)) fail('改派请选择其他维修员工或承包方');
    if(action==='reassign') {
      next.participantIds=[...new Set([...(task.participantIds||[]),...task.items.flatMap(i=>[i.startedBy,i.finishedBy,...(['待检验','已完工'].includes(i.status)?[i.responsibleId]:[])]).filter(Boolean)])];
    }
    Object.assign(next,execution,{technicianIds:ids});
    if(action==='reassign') {
      transferUnfinishedResponsibilities(next);
      // A new offer resets pauses from the previous team's acceptance.
      delete next.workerPauses;
    }
    if(action==='reconcile' && task.stage==='维修完成') {
      Object.assign(next,{technicianId:worker.id,technicianName:worker.name,needsReview:false,version:task.version+1});
      resolveRepairResponsibilities(next,people);
      return next;
    }
    if (!input.dueAt) fail('请填写预计完工时间',400);
    Object.assign(next,{ technicianId:worker.id, technicianName:worker.name, assignedBy:actor.id, assignedAt:now, acceptedAt:undefined, inspectorId:undefined, inspectorName:undefined, stage:'待接单', feedback:undefined, pausedAt:undefined,pauseReason:undefined,pauseNote:undefined, needsReview:false, dueAt:new Date(input.dueAt).toISOString(), urgent:input.urgent ?? task.urgent ?? false, note:input.note ?? task.note ?? '' });
    next.items.forEach(i=> { if(['待派工','待领料'].includes(i.status)) i.status='待开工'; });
    if(input.repairItems!==undefined) {
      editRepairItems(next,input.repairItems,actor,now,{startNewItems:false,allowRemoval:true});
      resolveRepairResponsibilities(next,people,{required:true});
    }
  } else if(action==='cancel') {
    requireSchedule(); stage('待接单','待开工'); reason();
    if(task.firstStartedAt || task.startHistoryUnknown || task.items.some(i=>i.startAt || ['维修中','待检验','已完工'].includes(i.status))) fail('已开工任务只能改派，不能撤销');
    Object.assign(next,{stage:'待派工',technicianIds:[],technicianId:undefined,technicianName:undefined,acceptedAt:undefined,assignedBy:undefined,assignedAt:undefined,feedback:undefined});
    next.items.forEach(i=>i.status='待派工');
  } else if(action==='reoffer') {
    requireSchedule(); stage('待接单'); technicianIds(task).forEach(id=>{const worker=person(id,task.executionMode==='outsourced'?['outsourcing','technician','advisor','manager','inspector','warehouse']:['technician']);if(task.contractorId&&!hasRole(worker, 'outsourcing')&&!worker.outsourcingRoleMember)fail('承包方已无外包角色，请重新派工',400);});
    next.feedback=undefined; next.assignedBy=actor.id; next.assignedAt=now;
  } else if(action==='accept' || action==='decline') {
    requireOwner(); stage('待接单');
    if(task.feedback) fail('已反馈无法接单，请等待服务顾问处理');
    if(action==='decline') { reason(); next.feedback=input.reason.trim(); }
    else {
      // Reassignment changes the handler, not the material handover.
      const parts=task.partsRequirement||validatePartsRequirement(input.partsRequirement);
      if(!task.partsRequirement)next.partsRequirement={...parts,applicantId:actor.id,applicantName:actor.name,recordedBy:actor.id,recordedName:actor.name,recordedAt:now,revision:task.version+1,batch:1};
      next.acceptedAt=now;
      if(parts.mode==='none'||parts.issuedAt||parts.preparedAt) beginPendingItems(next,actor,now);
      else next.stage='待开工';
    }
  } else if(action==='record-parts'||action==='edit-parts') {
    if(action==='edit-parts') {
      if(!hasRole(actor, 'warehouse'))fail('仅仓管可整理配件需求',403);
      if(!task.acceptedAt)fail('请等待维修工接单后再整理需求');
      if(task.partsRequirement?.issuedAt||task.partsRequirement?.preparedAt)fail('已完成配件不可修改，请由维修工追加申请');
      if(input.partsRequirement?.mode==='photo')fail('请将配件整理为明细，或选择无需配件',400);
    } else requireOwner();
    stage('待开工','维修中','暂停','回审');
    if(task.partsRequirement?.items?.some(i=>i.issuedAt||i.preparedAt)&&!task.partsRequirement.issuedAt&&!task.partsRequirement.preparedAt)fail('本批已部分处理，不能修改申请，请先完成剩余备料');
    next.partsRequirement={...validatePartsRequirement(input.partsRequirement),applicantId:action==='edit-parts'?(task.partsRequirement?.applicantId||task.partsRequirement?.ownerId||task.partsRequirement?.recordedBy):actor.id,applicantName:action==='edit-parts'?(task.partsRequirement?.applicantName||task.partsRequirement?.ownerName||task.partsRequirement?.recordedName):actor.name,recordedBy:actor.id,recordedName:actor.name,recordedAt:now,revision:task.version+1};
    if(action==='edit-parts') {
      if(input.partsRequirement.referencePhotoIds===undefined&&next.partsRequirement.mode!=='none'&&task.partsRequirement?.referencePhotoIds?.length)next.partsRequirement.referencePhotoIds=[...task.partsRequirement.referencePhotoIds];
      const sourcePhotoIds=task.partsRequirement?.mode==='photo'?task.partsRequirement.photoIds:task.partsRequirement?.sourcePhotoIds;
      if(sourcePhotoIds?.length)next.partsRequirement.sourcePhotoIds=[...sourcePhotoIds];
    }
    const partsActor=action==='edit-parts'?{id:task.technicianId||technicianIds(task)[0]||task.assignedBy}:actor;
    // After issue, this is a new batch. Previous issued quantities remain in audit events.
    next.partsRequirement.batch=(task.partsRequirement?.batch||1)+(task.partsRequirement?.issuedAt||task.partsRequirement?.preparedAt?1:0);
    if(task.stage==='待开工' && next.partsRequirement.mode==='none') beginPendingItems(next,partsActor,now);
    if(task.stage==='暂停' && task.resumeStage==='待开工' && next.partsRequirement.mode==='none') {
      beginPendingItems(next,partsActor,now);next.stage='暂停';next.resumeStage='维修中';
    }
  } else if(action==='confirm-parts' || action==='issue-parts') {
    if(!hasRole(actor, 'warehouse')) fail('仅仓管可备料或确认出库',403);
    stage('待开工','维修中','暂停','回审');
    if(!task.acceptedAt) fail('请等待维修工接单并确认配件需求');
    if(!task.partsRequirement || task.partsRequirement.mode==='none') fail('没有待处理的配件申请');
    if(task.partsRequirement.issuedAt) fail('该批配件已出库，请勿重复操作');
    if(action==='confirm-parts') {
      if(task.partsRequirement.preparedAt) fail('该批配件已备料完成，请勿重复操作');
      if(input.partsPreparation)next.partsRequirement=prepareParts(task,input,actor,people,now,recipientScope);
      else Object.assign(next.partsRequirement,{preparedBy:actor.id,preparedName:actor.name,preparedAt:now});
      if(next.partsRequirement.preparedAt&&(task.stage==='待开工'||task.stage==='暂停'&&task.resumeStage==='待开工')) {
        beginPendingItems(next,{id:task.technicianId||technicianIds(task)[0]||task.assignedBy},now);
        if(task.stage==='暂停'){next.stage='暂停';next.resumeStage='维修中';}
      }
    } else {
      next.partsRequirement=issueParts(task,input,actor,people,now,recipientScope);
      if(next.partsRequirement.issuedAt&&(task.stage==='待开工' || task.stage==='暂停' && task.resumeStage==='待开工')) {
        const repairActor={id:task.technicianId || technicianIds(task)[0] || task.assignedBy};
        beginPendingItems(next,repairActor,now);
        if(task.stage==='暂停') {next.stage='暂停';next.resumeStage='维修中';}
      }
      if(next.partsRequirement.issuedAt)next.items.forEach(i=>{if(i.status!=='已完工'&&next.partsRequirement.recipientIds.includes(i.responsibleId||task.technicianId)) i.pickedAt ||= now;});
    }
  } else if(action==='start-order') {
    requireOwner(); stage('待开工','维修中');assertPartsIssued(task);
    const pending=next.items.filter(i=>['待开工','待派工','待领料'].includes(i.status));
    if(!pending.length) fail('没有需要开工的维修项目');
    pending.forEach(i=>{i.status='维修中';i.startAt=now;i.startedBy=actor.id;i.finishAt=undefined;});
    next.firstStartedAt ||= now; next.stage='维修中';
    next.participantIds=[...new Set([...(task.participantIds||[]),actor.id])];
  } else if(action==='edit-repair-items') {
    const scheduler=!personalEditing&&hasAnyRole(actor, scheduling);
    if(scheduler) {stage('待派工','待接单','待开工','维修中','暂停','回审','维修完成');prepareSettlementAssignment(next,input);}
    else {requireOwner();stage('待开工','维修中','暂停');}
    if(scheduler&&task.stage==='待派工')transferUnfinishedResponsibilities(next);
    editRepairItems(next,input.repairItems,actor,now,{startNewItems:!scheduler,allowRemoval:scheduler});
    if(scheduler&&task.stage==='待派工'&&next.items.some(i=>i.responsibleId)) fail('请在指派维修工时分配项目负责人',400);
    if(scheduler&&task.stage!=='待派工'&&task.executionMode!=='outsourced') {
      for(const item of task.items) {
        const edited=next.items.find(i=>i.id===item.id);
        if(item.startAt&&edited?.responsibleId!==item.responsibleId)
          next.participantIds=[...new Set([...(next.participantIds||[]),item.responsibleId,item.startedBy,item.finishedBy].filter(Boolean))];
      }
      const fallback=task.stage==='维修完成'?next.items.map(item=>item.responsibleId).filter(Boolean):technicianIds(task).filter(id=>!task.items.some(i=>i.responsibleId===id)||next.items.some(i=>i.responsibleId===id));
      next.technicianIds=[...new Set([...fallback,...next.items.filter(i=>!['待检验','已完工'].includes(i.status)).map(i=>i.responsibleId).filter(Boolean)])];
      next.technicianId=next.technicianIds[0];
      next.technicianName=next.technicianIds.map(id=>people.find(p=>p.id===id)?.name||next.items.find(i=>i.responsibleId===id)?.responsibleName||id).join('、');
    }
    resolveRepairResponsibilities(next,people,{required:scheduler&&task.stage!=='待派工',rejectInvalid:true});
  } else if(action==='submit-order') {
    requireOwner(); stage('维修中');
    assertPartsIssued(task);
    if(input.repairItems!==undefined)editRepairItems(next,input.repairItems,actor,now);
    resolveRepairResponsibilities(next,people,{required:true});
    if(!next.items.length) fail('没有维修项目');
    const unstarted=next.items.filter(i=>['待开工','待派工','待领料'].includes(i.status));
    if(unstarted.length) fail(task.rework?`退回项目尚未开工：${unstarted.map(i=>i.name).join('、')}，请先点击开始返工`:'全部维修项目开工后才能提交完工');
    if(next.items.some(i=>!['维修中','待检验','已完工'].includes(i.status))) fail('维修项目状态异常');
    next.items.filter(i=>i.status==='维修中').forEach(i=>{i.status='待检验';i.finishAt=now;i.finishedBy=actor.id;});
    next.participantIds=[...new Set([...(task.participantIds||[]),actor.id])];
    Object.assign(next,{stage:'待检验',submittedAt:now,submissionNote:input.note||''});
  } else if(action==='claim-inspection' || action==='reassign-inspection') {
    if(!hasPendingInspection(task))fail('当前没有待检验项目');
    let inspector=actor;
    if(action==='reassign-inspection') {if(!hasAnyRole(actor, ['manager','inspector'])) fail('仅检验员或管理员可重新分配检验',403);reason();inspector=person(input.inspectorId,['inspector','manager']);}
    else if(task.inspectorId) fail('任务已被领取，请刷新');
    if(!canInspect(task,inspector)) fail('不能自检，或没有当前任务检验权限',403);
    Object.assign(next,{inspectorId:inspector.id,inspectorName:inspector.name,inspectionClaimedAt:now});
  } else if(action==='retry-scheduler-notifications') {
    requireSchedule();
  } else if(action==='retry-inspection-notifications') {
    if(!hasAnyRole(actor, [...scheduling,'inspector'])) fail('仅检验员、服务顾问或管理员可重试检验通知',403);
    if(!hasPendingInspection(task))fail('当前没有待检验项目');
  } else if(['start','finish','pick'].includes(action)) {
    requireOwner(); stage('待开工','维修中'); assertPartsIssued(task);const current=item();
    if(action==='start') { if(!['待开工','待派工','待领料'].includes(current.status)) fail('该项目不能开工'); current.status='维修中'; current.startAt ||= now; current.startedBy=actor.id; next.participantIds=[...new Set([...(task.participantIds||[]),actor.id])]; next.firstStartedAt ||= now; next.stage='维修中'; }
    if(action==='finish') { resolveRepairResponsibilities(next,people,{required:true});if(current.status!=='维修中') fail('请先开工'); current.status='待检验'; current.finishAt=now; current.finishedBy=actor.id; next.participantIds=[...new Set([...(task.participantIds||[]),actor.id])]; }
    if(action==='pick') { if(current.pickedAt) fail('已确认领料'); current.pickedAt=now; }
  } else if(action==='pause') {
    requireOwner(); stage('待开工','维修中');
    if(!['待配件','待客户确认','技术问题','其他'].includes(input.pauseReason)) fail('请选择暂停原因',400);
    if(input.pauseReason==='其他' && !input.note?.trim()) fail('请说明暂停原因',400);
    next.resumeStage=task.stage; next.stage='暂停'; next.pauseReason=input.pauseReason; next.pauseNote=input.note || ''; next.pausedAt=now;
  } else if(action==='resume') {
    requireOwner(); stage('暂停'); next.stage=task.resumeStage || '维修中'; next.pausedAt=undefined; next.pauseReason=undefined; next.pauseNote=undefined;
  } else if(action==='submit') {
    requireOwner(); if((task.technicianIds||[]).length>1)fail('请分别提交本人项目完工'); stage('维修中');assertPartsIssued(task);resolveRepairResponsibilities(next,people,{required:true});
    if(!next.items.length || next.items.some(i=>!['待检验','已完工'].includes(i.status))) fail('全部维修项目完成后才能提报');
    if(hasPendingInspection(task)&&task.inspectorId&&input.inspectorId!==task.inspectorId) fail('检验任务已被领取，请由检验员交接后再提交');
    const inspector=person(input.inspectorId,['inspector','manager']);
    if(!canInspect(task,inspector) || technicianIds(task).includes(inspector.id) || (task.participantIds||[]).includes(inspector.id) || next.items.some(i=>i.startedBy===inspector.id || i.finishedBy===inspector.id)) fail('不能选择维修工本人检验',403);
    next.inspectorId=inspector.id; next.inspectorName=inspector.name; next.stage='待检验'; next.submittedAt=now; next.submissionNote=input.note || '';
  } else if(action==='inspect') {
    if(!hasPendingInspection(task))fail('当前没有待检验项目');
    if(!canInspect(task,actor) || !hasAnyRole(actor, ['manager','inspector']) || (!hasRole(actor, 'manager')&&task.inspectorId!==actor.id) || (actor.id===task.technicianId || technicianIds(task).includes(actor.id) || (task.participantIds||[]).includes(actor.id)) || next.items.some(i=>i.responsibleId===actor.id || i.startedBy===actor.id || i.finishedBy===actor.id)) fail('不能自检，或没有当前任务检验权限',403);
    const rejected=input.rejectedItemIds || [];
    // Only submitted items belong to this inspection; unfinished work may still await assignment.
    resolveRepairResponsibilities({...next,items:next.items.filter(i=>i.status==='待检验'&&!rejected.includes(i.id))},people,{required:true});
    if(rejected.length) reason();
    if(rejected.length && input.workHours!==undefined) fail('退回维修时无需填写工时，请在全部检验通过时填写',400);
    if(rejected.some(id=>!next.items.some(i=>i.id===id && i.status==='待检验'))) fail('退回项目不在本次待检验项目中',400);
    for(const current of next.items) {
      if(current.status!=='待检验') continue;
      if(rejected.includes(current.id)) {
        next.participantIds=[...new Set([...(next.participantIds||[]),current.responsibleId,current.startedBy,current.finishedBy].filter(Boolean))];
        current.status='待开工'; current.finishAt=undefined; current.rejectionReason=input.reason.trim();
        const handover={executionMode:next.executionMode,technicianIds:technicianIds(next),items:[current]};
        const ownerStillValid=next.executionMode!=='outsourced'&&people.some(p=>p.id===current.responsibleId&&p.active&&hasRole(p, 'technician')&&p.shopId===next.shopId&&technicianIds(next).includes(p.id));
        if(!ownerStillValid)transferUnfinishedResponsibilities(handover);
      }
      else { delete current.rejectionReason; current.status='已完工'; current.inspectedBy=actor.id; current.inspectorName=actor.name; current.inspectedAt=now; }
    }
    if(rejected.length) { next.reworkReason=input.reason; next.rejectedItemIds=rejected; next.stage=['暂停','回审'].includes(task.stage)?task.stage:'维修中'; next.rework=true; next.reworkCount=(task.reworkCount||0)+1; }
    else {
      const completed=next.items.every(i=>i.status==='已完工')&&allWorkersHaveItems(next);
      if(input.workHours!==undefined&&!completed) fail('全部项目检验通过后才能填写整单工时',400);
      if(input.workHours!==undefined) Object.assign(next,{workHours:input.workHours,workHoursRecordedBy:actor.id,workHoursRecordedName:actor.name,workHoursRecordedAt:now});
      next.stage=completed?'维修完成':['回审','暂停'].includes(task.stage)?task.stage:'维修中';
      if(completed) Object.assign(next,{completedAt:now,completedBy:task.technicianId,rework:false});
      next.inspectorId=actor.id; next.inspectorName=actor.name;
    }
  } else if(action==='record-hours') {
    if(!canInspect(task,actor) || task.inspectorId!==actor.id) fail('仅本单检验人可补录工时',403);
    stage('维修完成');
    if(task.workHours!==undefined) fail('工时已记录，请勿重复录入');
    if(input.workHours===undefined) fail('请填写实际工时',400);
    if(task.workHours!==undefined) reason();
    Object.assign(next,{workHours:input.workHours,workHoursRecordedBy:actor.id,workHoursRecordedName:actor.name,workHoursRecordedAt:now});
  } else if(action==='update-due') {
    if (!hasAnyRole(actor, ['manager','advisor','inspector'])) fail('仅服务顾问、管理员或检验员可修改预计完工时间',403);
    if (!canEditDispatchDue(task,actor)) fail('当前任务不能修改预计完工时间');
    next.dueAt=new Date(input.dueAt).toISOString();
  } else if(action==='update') {
    requireSchedule(); if(task.stage==='维修完成') fail('已完成任务不能调整');
    if(input.dueAt) next.dueAt=new Date(input.dueAt).toISOString();
    if(input.urgent!==undefined) next.urgent=input.urgent;
    if(input.note!==undefined) next.note=input.note;
    if(input.executionMode!==undefined && input.executionMode!==(task.executionMode||'internal')) fail('变更执行方式请使用改派',400);
    if(input.contractorId!==undefined && input.contractorId!==task.contractorId) fail('变更承包方请使用改派',400);
    if(input.contractor!==undefined && input.contractor!==task.contractor) fail('变更承包方请使用改派',400);
    if(input.outsourcingMode!==undefined && input.outsourcingMode!==task.outsourcingMode) fail('变更外包施工方式请使用改派',400);
    if(task.stage!=='待派工') Object.assign(next,executionDetails({...task,...input}));
  } else if(['remind','retry-notification'].includes(action)) {
    requireSchedule(); if(action==='remind' && ['待派工','维修完成'].includes(task.stage)) fail('当前任务没有待处理人');
  }
  if(['assign','reassign','reconcile','reopen-repair','accept','edit-repair-items','inspect'].includes(action)&&input.reassignItemIds===undefined)resolveRepairResponsibilities(next,people);
  if(['edit-repair-items','submit-order'].includes(action)&&task.stage!=='待派工'&&task.executionMode!=='outsourced') {
    const handover=task.items.some(item=>item.responsibleId&&next.items.some(edited=>edited.id===item.id&&edited.responsibleId!==item.responsibleId));
    if(handover)reason();
  }
  if(['reassign','edit-repair-items'].includes(action)&&next.workerPauses) {
    const retained=new Set(technicianIds(next));
    next.workerPauses=Object.fromEntries(Object.entries(next.workerPauses).filter(([id])=>retained.has(id)));
  }
  if(['finish','submit-order'].includes(action)&&!hasPendingInspection(task)&&hasPendingInspection(next)) {
    // A new batch needs a new claim; adding work to an active batch preserves its inspector.
    delete next.inspectorId;delete next.inspectorName;delete next.inspectionClaimedAt;
  }
  next.version += 1;
  return next;
}
export function dispatchMetric(task, metric, from, to, now = new Date()) {
  switch(metric) {
    case 'current': return task.stage!=='维修完成';
    case 'pendingAccept': return task.stage==='待接单';
    case 'unstarted': return Boolean((technicianIds(task).length || task.executionMode==='outsourced') && task.stage!=='维修完成' && !task.firstStartedAt && !task.startHistoryUnknown && !task.items.some(i=>i.startAt || ['维修中','待检验','已完工'].includes(i.status)));
    case 'working': return task.stage==='维修中';
    case 'paused': return task.stage==='暂停';
    case 'inspection': return hasPendingInspection(task);
    case 'completed': return Boolean(task.stage==='维修完成' && task.completedAt && task.completedAt>=from && task.completedAt<to);
    case 'overdue': return task.stage!=='维修完成' && Boolean(task.dueAt && Date.parse(task.dueAt)<now.getTime());
    case 'rework': return task.stage!=='维修完成' && Boolean(task.rework);
    default: return false;
  }
}
export function completionRange(from, to, now = new Date()) {
  const local=new Date(now.getTime()+8*3600000);
  const first=`${local.getUTCFullYear()}-${String(local.getUTCMonth()+1).padStart(2,'0')}-01`;
  const last=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth()+1,0)).toISOString().slice(0,10);
  const parse = value => { if(!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value) fail('日期无效',400); return Date.parse(`${value}T00:00:00+08:00`); };
  // Only an entirely empty range defaults to this month; a single bound stays open.
  const defaultMonth=!from&&!to;
  const start=from?parse(from):defaultMonth?parse(first):Date.parse('0001-01-01T00:00:00.000Z');
  const end=to?parse(to)+86400000:defaultMonth?parse(last)+86400000:Date.parse('9999-12-31T23:59:59.999Z');
  if(start>=end) fail('结束日期不能早于开始日期',400);
  return {from:new Date(start).toISOString(),to:new Date(end).toISOString()};
}

const executionKeys=['executionMode','serviceUnit','serviceAddress','serviceContact','departureAt','expectedReturnAt','returnedAt','contractor','contractorId','outsourcingMode','agreedFee','handedOverAt','receivedAt'];
function validateExecution(input) {
  if(input.executionMode!==undefined && !['internal','field','outsourced'].includes(input.executionMode)) fail('执行方式无效',400);
  if(input.outsourcingMode!==undefined && !['onsite','offsite'].includes(input.outsourcingMode)) fail('外包施工方式无效',400);
  for(const key of ['serviceUnit','serviceAddress','serviceContact','contractor','contractorId']) if(input[key]!==undefined && (typeof input[key]!=='string' || input[key].length>2000)) fail('外派或外包信息无效',400);
  for(const key of ['departureAt','expectedReturnAt','returnedAt','handedOverAt','receivedAt']) if(input[key]!==undefined && (typeof input[key]!=='string' || input[key] && (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input[key]) || !Number.isFinite(Date.parse(input[key]))))) fail('交接时间必须包含时区',400);
  if(input.agreedFee!=null && (typeof input.agreedFee!=='number' || !Number.isFinite(input.agreedFee) || input.agreedFee<0 || input.agreedFee>999999999 || Math.abs(input.agreedFee*100-Math.round(input.agreedFee*100))>0.00001)) fail('约定费用须为非负金额，最多两位小数',400);
}
function executionDetails(input) {
  const mode=input.executionMode||'internal';
  if(mode==='field' && (!input.serviceUnit?.trim() || !input.serviceAddress?.trim())) fail('外修请填写服务单位和施工地址',400);
  if(mode==='outsourced' && (!input.contractor?.trim() || !input.outsourcingMode)) fail('外包请填写承包方并选择施工方式',400);
  for(const [start,end] of [['departureAt','expectedReturnAt'],['departureAt','returnedAt'],['handedOverAt','receivedAt']]) {
    if(input[end] && !input[start]) fail('请先填写出发或交车时间',400);
    if(input[start] && input[end] && Date.parse(input[end])<Date.parse(input[start])) fail('返回或收车时间不能早于出发或交车时间',400);
  }
  const keys=mode==='field'?['serviceUnit','serviceAddress','serviceContact','departureAt','expectedReturnAt','returnedAt']:mode==='outsourced'?['contractor','contractorId','outsourcingMode','agreedFee','serviceAddress','serviceContact',...(input.outsourcingMode==='offsite'?['handedOverAt','receivedAt']:[])]:[];
  return Object.fromEntries(executionKeys.map(key=>[key,key==='executionMode'?mode:keys.includes(key)?input[key]:undefined]));
}
