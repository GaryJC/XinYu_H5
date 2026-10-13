import { HttpError } from '../http/HttpError.mjs';
export const DISPATCH_ROLES = ['manager','advisor','technician','inspector'];
export const technicianIds = task => task.technicianIds ?? (task.technicianId ? [task.technicianId] : []);
const scheduling = ['manager','advisor'];
const fail = (message, status = 409) => { throw new HttpError(status, message); };
export function assertDispatchAccess(task, actor) {
  if (!actor?.active || !DISPATCH_ROLES.includes(actor.role) || task.shopId !== actor.shopId) fail('无权访问该门店任务',403);
  if (scheduling.includes(actor.role)) return;
  if (['草稿','待客户签字'].includes(task.orderStatus)) fail('客户尚未签字，无权访问该维修任务',403);
  if (actor.role === 'technician' && technicianIds(task).includes(actor.id)) return;
  if (actor.role === 'inspector' && task.inspectorId === actor.id) return;
  fail('任务已改派或不属于当前员工',403);
}
export function validateDispatchRequest(input) {
  const actions = ['record-hours','assign','reassign','reoffer','cancel','accept','decline','start','finish','pick','pause','resume','submit','inspect','update','remind','retry-notification','reconcile'];
  if (!input || !actions.includes(input.action) || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId)) fail('操作参数无效：需要版本号及唯一请求编号',400);
  for (const key of ['note','reason','pauseReason','technicianId','inspectorId','notificationId']) {
    if (input[key] !== undefined && (typeof input[key] !== 'string' || input[key].length > 2000)) fail('文本参数无效',400);
  }
  if (input.technicianIds !== undefined && (!Array.isArray(input.technicianIds) || input.technicianIds.length>100 || input.technicianIds.some(id=>typeof id!=='string' || !id || id.length>200) || new Set(input.technicianIds).size!==input.technicianIds.length)) fail('维修员工名单无效',400);
  if(input.workHours!==undefined && (typeof input.workHours!=='number' || !Number.isFinite(input.workHours) || input.workHours<=0 || input.workHours>10000 || Math.abs(input.workHours*100-Math.round(input.workHours*100))>0.000001)) fail('工时须大于 0 且不超过 10000 小时，最多两位小数',400);
  if(input.workHours!==undefined && input.action!=='record-hours') fail('请通过录入工时操作填写',400);
  validateExecution(input);
  if (input.urgent !== undefined && typeof input.urgent !== 'boolean') fail('加急参数无效',400);
  if (input.itemId !== undefined && !Number.isSafeInteger(input.itemId)) fail('维修项目编号无效',400);
  if (input.rejectedItemIds !== undefined && (!Array.isArray(input.rejectedItemIds) || input.rejectedItemIds.some(id=>!Number.isSafeInteger(id)) || new Set(input.rejectedItemIds).size !== input.rejectedItemIds.length)) fail('退回项目无效',400);
  if (input.dueAt !== undefined && (typeof input.dueAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.dueAt) || !Number.isFinite(Date.parse(input.dueAt)))) fail('预计完工时间必须包含时区',400);
  return input;
}
export function applyDispatchAction(task, input, actor, people, now = new Date().toISOString()) {
  validateDispatchRequest(input);
  assertDispatchAccess(task,actor);
  if (['草稿','待客户签字'].includes(task.orderStatus) || ['草稿','待客户签字'].includes(task.stage)) fail('客户签字后才能执行派工操作');
  if (task.version !== input.expectedVersion) fail('任务已更新，请刷新后重试');
  const next = structuredClone(task);
  const action = input.action;
  const requireSchedule = () => { if(!scheduling.includes(actor.role)) fail('仅服务顾问或管理员可调度任务',403); };
  const requireOwner = () => { if(!(task.executionMode==='outsourced' ? scheduling.includes(actor.role) : technicianIds(task).includes(actor.id) && actor.role==='technician')) fail('仅当前维修工可执行此操作',403); };
  const stage = (...stages) => { if (!stages.includes(task.stage)) fail(`当前${task.stage}不能执行该操作`); };
  const reason = () => { if (!input.reason?.trim()) fail('请填写原因或交接说明',400); };
  const person = (id, roles) => { const found = people.find(u=>u.id===id && u.active && u.shopId===task.shopId && roles.includes(u.role)); if(!found) fail('人员不存在、已停用或不属于本店',400); return found; };
  const item = () => { const found = next.items.find(i=>i.id===input.itemId); if(!found) fail('维修项目不存在',404); return found; };
  if (task.stage==='待检验' && task.items.some(i=>!['待检验','已完工'].includes(i.status))) fail('任务与项目进度不一致，请联系管理员');
  if (task.needsReview && !['reconcile','remind','retry-notification'].includes(action)) fail('历史任务需要管理员先核对归属和进度');
  if (['assign','reassign','reconcile'].includes(action)) {
    requireSchedule();
    if(action==='reconcile') { if(actor.role!=='manager' || !task.needsReview) fail('仅管理员可核对历史任务',403); reason(); }
    else if(action==='assign') stage('待派工'); else { stage('待接单','待开工','维修中','暂停'); reason(); }
    const mode=input.executionMode ?? task.executionMode ?? 'internal';
    const ids=mode==='outsourced'?[]:(input.technicianIds ?? (input.technicianId?[input.technicianId]:[]));
    if(mode!=='outsourced' && !ids.length) fail('请选择维修员工',400);
    const workers=ids.map(id=>person(id,['technician']));
    const worker={id:workers[0]?.id,name:workers.map(p=>p.name).join('、') || input.contractor || task.contractor};
    const execution=executionDetails({...task,...input,executionMode:mode});
    if(action==='reassign' && mode===(task.executionMode||'internal') && [...ids].sort().join() === [...technicianIds(task)].sort().join() && (mode!=='outsourced' || execution.contractor===task.contractor && execution.outsourcingMode===task.outsourcingMode)) fail('改派请选择其他维修员工或承包方');
    Object.assign(next,execution,{technicianIds:ids});
    if(action==='reconcile' && task.stage==='维修完成') {
      Object.assign(next,{technicianId:worker.id,technicianName:worker.name,needsReview:false,version:task.version+1});
      return next;
    }
    if (!input.dueAt) fail('请填写预计完工时间',400);
    Object.assign(next,{ technicianId:worker.id, technicianName:worker.name, assignedBy:actor.id, assignedAt:now, acceptedAt:undefined, inspectorId:undefined, inspectorName:undefined, stage:'待接单', feedback:undefined, pausedAt:undefined,pauseReason:undefined,pauseNote:undefined, needsReview:false, dueAt:new Date(input.dueAt).toISOString(), urgent:input.urgent ?? task.urgent ?? false, note:input.note ?? task.note ?? '' });
    next.items.forEach(i=> { if(['待派工','待领料'].includes(i.status)) i.status='待开工'; });
  } else if(action==='cancel') {
    requireSchedule(); stage('待接单','待开工'); reason();
    if(task.firstStartedAt || task.startHistoryUnknown || task.items.some(i=>i.startAt || ['维修中','待检验','已完工'].includes(i.status))) fail('已开工任务只能改派，不能撤销');
    Object.assign(next,{stage:'待派工',technicianIds:[],technicianId:undefined,technicianName:undefined,acceptedAt:undefined,assignedBy:undefined,assignedAt:undefined,feedback:undefined});
    next.items.forEach(i=>i.status='待派工');
  } else if(action==='reoffer') {
    requireSchedule(); stage('待接单'); technicianIds(task).forEach(id=>person(id,['technician']));
    next.feedback=undefined; next.assignedBy=actor.id; next.assignedAt=now;
  } else if(action==='accept' || action==='decline') {
    requireOwner(); stage('待接单');
    if(task.feedback) fail('已反馈无法接单，请等待服务顾问处理');
    if(action==='decline') { reason(); next.feedback=input.reason.trim(); }
    else { next.acceptedAt=now; next.stage=task.firstStartedAt || task.startHistoryUnknown || task.items.some(i=>['维修中','待检验','已完工'].includes(i.status)) ? '维修中':'待开工'; }
  } else if(['start','finish','pick'].includes(action)) {
    requireOwner(); stage('待开工','维修中'); const current=item();
    if(action==='start') { if(!['待开工','待派工','待领料'].includes(current.status)) fail('该项目不能开工'); current.status='维修中'; current.startAt ||= now; current.startedBy=actor.id; next.participantIds=[...new Set([...(task.participantIds||[]),actor.id])]; next.firstStartedAt ||= now; next.stage='维修中'; }
    if(action==='finish') { if(current.status!=='维修中') fail('请先开工'); current.status='待检验'; current.finishAt=now; current.finishedBy=actor.id; next.participantIds=[...new Set([...(task.participantIds||[]),actor.id])]; }
    if(action==='pick') { if(current.pickedAt) fail('已确认领料'); current.pickedAt=now; }
  } else if(action==='pause') {
    requireOwner(); stage('待开工','维修中');
    if(!['待配件','待客户确认','技术问题','其他'].includes(input.pauseReason)) fail('请选择暂停原因',400);
    if(input.pauseReason==='其他' && !input.note?.trim()) fail('请说明暂停原因',400);
    next.resumeStage=task.stage; next.stage='暂停'; next.pauseReason=input.pauseReason; next.pauseNote=input.note || ''; next.pausedAt=now;
  } else if(action==='resume') {
    requireOwner(); stage('暂停'); next.stage=task.resumeStage || '维修中'; next.pausedAt=undefined; next.pauseReason=undefined; next.pauseNote=undefined;
  } else if(action==='submit') {
    requireOwner(); stage('维修中');
    if(!next.items.length || next.items.some(i=>!['待检验','已完工'].includes(i.status))) fail('全部维修项目完成后才能提报');
    const inspector=person(input.inspectorId,['inspector','manager']);
    if(technicianIds(task).includes(inspector.id) || (task.participantIds||[]).includes(inspector.id) || next.items.some(i=>i.startedBy===inspector.id || i.finishedBy===inspector.id)) fail('不能选择维修工本人检验',403);
    next.inspectorId=inspector.id; next.inspectorName=inspector.name; next.stage='待检验'; next.submittedAt=now; next.submissionNote=input.note || '';
  } else if(action==='inspect') {
    stage('待检验');
    if(!['manager','inspector'].includes(actor.role) || (actor.role!=='manager' && task.inspectorId!==actor.id) || (actor.id===task.technicianId || technicianIds(task).includes(actor.id) || (task.participantIds||[]).includes(actor.id)) || next.items.some(i=>i.startedBy===actor.id || i.finishedBy===actor.id)) fail('不能自检，或没有当前任务检验权限',403);
    const rejected=input.rejectedItemIds || [];
    if(rejected.length) reason();
    if(rejected.some(id=>!next.items.some(i=>i.id===id && i.status==='待检验'))) fail('退回项目不在本次待检验项目中',400);
    for(const current of next.items) {
      if(current.status!=='待检验') continue;
      if(rejected.includes(current.id)) { current.status='待开工'; current.finishAt=undefined; }
      else { current.status='已完工'; current.inspectedBy=actor.id; current.inspectorName=actor.name; current.inspectedAt=now; }
    }
    if(rejected.length) { next.stage='维修中'; next.rework=true; next.reworkCount=(task.reworkCount||0)+1; }
    else { next.stage='维修完成'; next.completedAt=now; next.completedBy=task.technicianId; next.inspectorName=actor.name; next.rework=false; }
  } else if(action==='record-hours') {
    requireSchedule(); stage('维修中','暂停','待检验','维修完成');
    if(task.orderStatus==='完成') fail('已完结工单不能修改工时');
    if(input.workHours===undefined) fail('请填写实际工时',400);
    if(task.workHours!==undefined) reason();
    Object.assign(next,{workHours:input.workHours,workHoursRecordedBy:actor.id,workHoursRecordedName:actor.name,workHoursRecordedAt:now});
  } else if(action==='update') {
    requireSchedule(); if(task.stage==='维修完成') fail('已完成任务不能调整');
    if(input.dueAt) next.dueAt=new Date(input.dueAt).toISOString();
    if(input.urgent!==undefined) next.urgent=input.urgent;
    if(input.note!==undefined) next.note=input.note;
    if(input.executionMode!==undefined && input.executionMode!==(task.executionMode||'internal')) fail('变更执行方式请使用改派',400);
    if(input.contractor!==undefined && input.contractor!==task.contractor) fail('变更承包方请使用改派',400);
    if(input.outsourcingMode!==undefined && input.outsourcingMode!==task.outsourcingMode) fail('变更外包施工方式请使用改派',400);
    if(task.stage!=='待派工') Object.assign(next,executionDetails({...task,...input}));
  } else if(['remind','retry-notification'].includes(action)) {
    requireSchedule(); if(action==='remind' && ['待派工','维修完成'].includes(task.stage)) fail('当前任务没有待处理人');
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
    case 'inspection': return task.stage==='待检验';
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
  const start=parse(from||first); const end=parse(to||last)+86400000;
  if(start>=end) fail('结束日期不能早于开始日期',400);
  return {from:new Date(start).toISOString(),to:new Date(end).toISOString()};
}

const executionKeys=['executionMode','serviceUnit','serviceAddress','serviceContact','departureAt','expectedReturnAt','returnedAt','contractor','outsourcingMode','agreedFee','handedOverAt','receivedAt'];
function validateExecution(input) {
  if(input.executionMode!==undefined && !['internal','field','outsourced'].includes(input.executionMode)) fail('执行方式无效',400);
  if(input.outsourcingMode!==undefined && !['onsite','offsite'].includes(input.outsourcingMode)) fail('外包施工方式无效',400);
  for(const key of ['serviceUnit','serviceAddress','serviceContact','contractor']) if(input[key]!==undefined && (typeof input[key]!=='string' || input[key].length>2000)) fail('外派或外包信息无效',400);
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
  const keys=mode==='field'?['serviceUnit','serviceAddress','serviceContact','departureAt','expectedReturnAt','returnedAt']:mode==='outsourced'?['contractor','outsourcingMode','agreedFee','serviceAddress','serviceContact',...(input.outsourcingMode==='offsite'?['handedOverAt','receivedAt']:[])]:[];
  return Object.fromEntries(executionKeys.map(key=>[key,key==='executionMode'?mode:keys.includes(key)?input[key]:undefined]));
}
