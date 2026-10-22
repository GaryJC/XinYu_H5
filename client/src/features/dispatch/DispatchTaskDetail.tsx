import { TaskDueDateEditor } from './TaskDueDateEditor';
import { hasRole, hasAnyRole } from "../../../../shared/roles.mjs";
import {RepairWritebackStatus} from './RepairWritebackStatus';
import {DispatchProjectsEditor} from './DispatchProjectsEditor';
import {DispatchItemProgressActions} from './DispatchItemProgressActions';
import {RepairProjectChanges} from './RepairProjectChanges';
import {InspectionItems,PassedInspectionItems} from './InspectionItems';
import {useInspectionDraft} from './useInspectionDraft';
import type {InspectionReview} from './inspectionReview';
import { TaskOverview } from './TaskOverview';
import './task-detail.css';
import { RepairPhotoPanel } from './RepairPhotoPanel';
import { DispatchSheetSummary } from './DispatchSheetSummary';
import { PartsRequirementDialog } from './PartsRequirementDialog';
import { PartsRequirementSummary } from './PartsRequirementSummary';
import { RepairRoundHistory } from './RepairRoundHistory';
import { executionLabels,executionTextFields,executionTimeFields } from './DispatchExecutionFields';
import { useState } from 'react';
import { Alert,Button,Card,Collapse,Descriptions,Empty,Space,Tag,Timeline } from 'antd';
import type { DispatchActionName,UserProfile } from '../../../../shared/types';
import { AuthenticatedImage } from '../../shared/ui/AuthenticatedImage';
import {useElementHeight} from '../../shared/ui/useElementHeight';
import { requestBlob } from '../../shared/api/httpClient';
import type { DispatchController } from './useDispatchController';
import { dispatchEventLabel, actionLabels,displayTime,notificationLabels,taskStatusLabel } from './dispatchLabels';
import { DispatchActionDialog } from './DispatchActionDialog';
export function DispatchTaskDetail({controller,user}:{controller:DispatchController;user:UserProfile}) {
  const [projectActionsTarget,setProjectActionsTarget]=useState<HTMLDivElement|null>(null);
  const [actionBar,setActionBar]=useState<HTMLDivElement|null>(null);
  const actionBarHeight=useElementHeight(actionBar);
  const [photoBlocked,setPhotoBlocked]=useState(false);
  const [partsDialog,setPartsDialog]=useState(false);
  const [dialog,setDialog]=useState<DispatchActionName>();
  const detail=controller.detail;
  const inspectionDraft=useInspectionDraft(detail?.task);
  const [inspectionReview,setInspectionReview]=useState<InspectionReview>();
  if(!detail) return <>{controller.error?<Alert type="error" title={controller.error}/>:null}<Empty description="正在加载任务，或当前账号已无权访问"/></>;
  const {task,events,notifications,files}=detail;
  const unsigned=['草稿','待客户签字'].includes(task.orderStatus);
  const workers=task.technicianIds??(task.technicianId?[task.technicianId]:[]);
  const owner=workers.includes(user.id) && (hasAnyRole(user, ['technician','outsourcing'])||user.outsourcingRoleMember) || task.executionMode==='outsourced'&&controller.manager;
  const inspect=task.stage==='待检验' && hasAnyRole(user, ['manager','inspector']) && !workers.includes(user.id) && !task.participantIds?.includes(user.id) && !task.items.some(i=>i.responsibleId===user.id||i.startedBy===user.id||i.finishedBy===user.id);
  const waitingForParts=Boolean(task.partsRequirement&&task.partsRequirement.mode!=='none'&&!task.partsRequirement.issuedAt&&!task.partsRequirement.preparedAt);
  const actions:DispatchActionName[]=[];
  if(controller.manager&&!unsigned) {
    if(task.needsReview) {if(hasRole(user, 'manager')) actions.push('reconcile');}
    else {
      if(['待接单','待开工'].includes(task.stage)&&!task.firstStartedAt&&!task.startHistoryUnknown&&!task.items.some(i=>i.startAt||['维修中','待检验','已完工'].includes(i.status))) actions.push('cancel');
      if(task.stage==='待接单'&&task.feedback) actions.push('reoffer');
      if(task.executionMode==='outsourced'&&task.stage!=='维修完成') actions.push('update');
    }
    if(!['待派工','维修完成'].includes(task.stage)) actions.push('remind');
  }
  if(task.stage==='维修完成'&&!unsigned&&!task.needsReview&&hasAnyRole(user, ['manager','advisor','inspector'])) actions.push('reopen-repair');
  if(owner&&!unsigned&&!task.needsReview) {
    if(task.stage==='待接单'&&!task.feedback) actions.push('accept','decline');
    if(['待开工','维修中'].includes(task.stage)) actions.push('pause');
    if(task.stage==='暂停') actions.push('resume');
    if(!waitingForParts&&task.stage==='维修中'&&task.items.length&&task.items.every(i=>['待检验','已完工'].includes(i.status))) actions.push('submit');
  }
  const independent=!workers.includes(user.id)&&!task.participantIds?.includes(user.id)&&!task.items.some(i=>i.responsibleId===user.id||i.startedBy===user.id||i.finishedBy===user.id);
  if(['待检验','维修完成'].includes(task.stage)&&(task.orderStatus!=='完成'||Boolean(task.repairRound))&&independent&&hasAnyRole(user,['inspector','manager'])&&!task.needsReview) actions.push('send-review');
  if(task.stage==='待检验'&&!task.inspectorId&&independent&&hasAnyRole(user, ['inspector','manager'])&&!task.needsReview) actions.push('claim-inspection');
  if(task.stage==='待检验'&&task.inspectorId&&hasAnyRole(user, ['manager','inspector'])) actions.push('reassign-inspection');
  if(inspect&&task.inspectorId&&!unsigned&&!task.needsReview) actions.push('inspect');
  if(controller.inspectionLead&&task.stage==='待检验'&&!task.inspectorId&&detail.inspectionNotification?.error) actions.push('retry-inspection-notifications');
  async function openFile(id:string,name:string) {
    try {const blob=await requestBlob(`/api/files/${encodeURIComponent(id)}/content`);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
    catch(e){controller.setError(e instanceof Error?e.message:'附件加载失败');}
  }
  return <div className={`dispatch-detail task-detail-layout${actions.length?" has-task-actions":""}`} style={actions.length?{paddingBottom:Math.max(90,actionBarHeight+16)}:undefined}>
    <TaskOverview task={task} dueEditor={<TaskDueDateEditor key={`${task.orderId}-${user.id}`} controller={controller} user={user} blocked={photoBlocked} />}><Space wrap><Tag>{executionLabels[task.executionMode||'internal']}</Tag><Tag color="blue">{taskStatusLabel(task)}</Tag>{task.urgent?<Tag color="red">加急</Tag>:null}{task.overdue?<Tag color="red">超期</Tag>:null}{task.rework&&!task.repairRound?<Tag color="orange">返工第 {task.reworkCount} 次</Tag>:null}</Space></TaskOverview>
    {unsigned?<Alert type="info" showIcon title="确认客户签字后才能派工" description="请在委托开单中完成工单与客户签字，确认客户签字后即可从派工台安排维修。"/>:null}
    {task.needsReview?<Alert type="warning" title="历史任务待核对" description="历史记录未能完整确认人员或进度；管理员核对后才能继续，不补造历史时间。"/>:null}
    {task.feedback?<Alert type="warning" title="无法接单 · 待服务顾问处理" description={task.feedback}/>:null}
    {task.stage==='暂停'?<Alert type="warning" title={`暂停：${task.pauseReason}`} description={`${task.pauseNote||''} · 自 ${displayTime(task.pausedAt)}，已暂停 ${Math.max(0,Math.floor((Date.now()-Date.parse(task.pausedAt||''))/60000))} 分钟`}/>:null}
    {task.stage==='待检验'?<Alert type="info" title={task.inspectorName?`已由 ${task.inspectorName} 接手检验`:'等待检验员领取'}/>:null}
    {controller.error?<Alert type="error" showIcon title={controller.error}/>:null}
    {task.stage==='待检验'?<section className="task-projects">
      <h3>待检项目 · {inspectionDraft.pending.length} 项</h3>
      <InspectionItems items={task.items} choices={inspectionDraft.choices} onChange={inspectionDraft.change} disabled={!inspect||!task.inspectorId||unsigned||task.needsReview||controller.busy}/>
      <p className="inspection-progress">{inspect&&task.inspectorId?`已选择 ${inspectionDraft.pending.filter(item=>inspectionDraft.choices[item.id]).length} / ${inspectionDraft.pending.length} 项，请逐项确认通过或退回。`:'领取检验任务后，可逐项选择通过或退回。'}</p>
    </section>:<section className="task-projects">
    <h3>维修项目 · {task.items.filter(i=>['待检验','已完工'].includes(i.status)).length}/{task.items.length} 已提报或通过</h3>
    {controller.manager&&!unsigned&&!task.needsReview&&['待派工','待接单','待开工','维修中','暂停'].includes(task.stage)?<DispatchProjectsEditor key={task.orderId} task={task} controller={controller} actionsTarget={projectActionsTarget}/>:task.items.map(item=><Card key={item.id} size="small" title={item.name} extra={<Tag>{item.status}</Tag>}>
      <p>负责人：{item.responsibleName||'待指定'}</p>
      <div className="dispatch-item-times"><span>开工：{displayTime(item.startAt)}</span><span>完工提报：{displayTime(item.finishAt)}</span><span>检验：{item.inspectorName||'未检验'} · {displayTime(item.inspectedAt)}</span><span>领料确认：{displayTime(item.pickedAt)}</span></div>
      <DispatchItemProgressActions task={task} item={item} controller={controller} enabled={owner&&!unsigned}/>
    </Card>)}
    <p className="dispatch-muted">需要配件的任务由仓管确认出库后自动开工；无需配件直接开工。</p>
    </section>}
    {task.stage==='待检验'?<PassedInspectionItems items={task.items}/>:null}
    <RepairWritebackStatus controller={controller} admin={hasRole(user, 'manager')}/>
    <PartsRequirementSummary value={task.partsRequirement}/>
    {owner?<RepairPhotoPanel controller={controller} editable={!unsigned&&!task.needsReview&&['待开工','维修中','暂停'].includes(task.stage)} onBlocked={setPhotoBlocked}/>:null}
    {owner&&['待开工','维修中','暂停'].includes(task.stage)?<Button onClick={()=>setPartsDialog(true)} disabled={controller.busy}>{(task.partsRequirement?.issuedAt||task.partsRequirement?.preparedAt)?"追加配件申请":"补充／修改配件需求"}</Button>:null}
    {files.length?<><h3>维修附件</h3><Space wrap>{files.map(file=>file.mimeType.startsWith('image/')?<AuthenticatedImage key={file.id} fileId={file.id} alt={file.originalName} width={140} height={100}/>:<Button key={file.id} onClick={()=>void openFile(file.id,file.originalName)}>{file.originalName}</Button>)}</Space></>:null}
    {task.stage==='待检验'&&!task.inspectorId&&controller.inspectionLead&&detail.inspectionNotification&&detail.inspectionNotification.status!=='ready'&&detail.inspectionNotification.status!=='obsolete'?<Alert type={detail.inspectionNotification.error?'warning':'info'} title={detail.inspectionNotification.error||'正在安排检验通知'} description="工单已进入待检验队列，可重试检验通知。"/>:null}
    {controller.manager?detail.schedulerNotifications?.filter(job=>job.error).map(job=><Alert key={job.eventId} type="warning" showIcon title={`${job.kind}通知未完成`} description={job.error} action={<Button loading={controller.busy} disabled={controller.busy} onClick={()=>void controller.act({action:'retry-scheduler-notifications',notificationJobId:job.eventId})}>重试</Button>}/>):null}
    <Collapse size="small" items={[{key:"info",label:"任务信息与关键时间",children:<Descriptions column={1} size="small" items={[
      {key:'number',label:'委托单',children:task.orderId},
      {key:'dispatch',label:'派工号',children:task.dispatchNo||'待业务平台回填'},
      {key:'execution',label:'执行方式',children:executionLabels[task.executionMode||'internal']},
      ...Object.entries(executionTextFields).filter(([key])=>task[key as keyof typeof executionTextFields]).map(([key,label])=>({key,label,children:task[key as keyof typeof executionTextFields]})),
      ...Object.entries(executionTimeFields).filter(([key])=>task[key as keyof typeof executionTimeFields]).map(([key,label])=>({key,label,children:displayTime(task[key as keyof typeof executionTimeFields])})),
      ...(task.executionMode==='outsourced'?[{key:'outsourcingMode',label:'外包施工方式',children:task.outsourcingMode==='offsite'?'车辆外送整包维修':'承包方到店施工'},{key:'fee',label:'约定费用',children:task.agreedFee==null?'未填写':`¥${task.agreedFee.toFixed(2)}`}]:[]),
      {key:'technician',label:task.executionMode==='outsourced'?'承包方':'维修员工',children:task.technicianName||'未指派'},
      {key:'inspector',label:'检验人',children:task.inspectorName||'未指定'},
      {key:'hours',label:'实际工时',children:task.workHours===undefined?'未记录':`${task.workHours} 小时`},
      {key:'hoursActor',label:'工时记录',children:task.workHoursRecordedName?`${task.workHoursRecordedName} · ${displayTime(task.workHoursRecordedAt)}`:'未记录'},
      {key:'due',label:'预计完工',children:displayTime(task.dueAt)},
      {key:'assigned',label:'指派时间',children:displayTime(task.assignedAt)},
      {key:'accept',label:'接单时间',children:displayTime(task.acceptedAt)},
      {key:'start',label:'首次开工',children:displayTime(task.firstStartedAt)},
      {key:'submit',label:'提报时间',children:displayTime(task.submittedAt)},
      {key:'complete',label:'维修完成',children:displayTime(task.completedAt)},
      {key:'fault',label:'故障描述',children:task.faultDescription||'—'},
      {key:'note',label:'派工备注',children:task.note||'—'},
      {key:'submission',label:'提报说明',children:task.submissionNote||'—'}
    ]}/>}]}/>
    <Collapse items={[{key:"sheet",label:"完整派工单与接车照片",children:<DispatchSheetSummary task={task} files={files}/>}]} />
    <RepairRoundHistory detail={detail}/>
    <Collapse items={[{key:"history",label:"通知与操作记录",children:<>
    <h3>通知记录</h3>
    <p className="dispatch-muted">消息发送成功不代表维修工已接单。结果未知时不会自动重发。</p>
    {!notifications.length?<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无通知记录"/>:notifications.map(n=><div className="dispatch-notification" key={n.id}>
      <strong>{n.kind} · {n.recipientName}</strong><Tag color={n.status==='failed'?'red':n.status==='sent'?'green':'default'}>{notificationLabels[n.status]}</Tag>
      <span>{displayTime(n.createdAt)} · 尝试 {n.attempts} 次</span>{n.error?<span role="status">{n.error}</span>:null}
      {controller.manager&&n.status==='failed'?<Button size="small" loading={controller.busy} disabled={controller.busy} onClick={()=>void controller.act({action:'retry-notification',notificationId:n.id})}>重试通知</Button>:null}
    </div>)}
    <h3>操作与交接记录</h3>
    <Timeline items={events.map(event=>({children:<div><strong>{event.action==='due-reminder'?'即将到期提醒':dispatchEventLabel(event)} · {event.actorName}</strong><p>{displayTime(event.at)} · {event.detail.stage}{event.detail.repairRound?` · 返工第 ${event.detail.repairRound} 轮`:""}</p>
      {event.detail.previousTechnicianName&&event.detail.previousTechnicianName!==event.detail.technicianName?<p>{event.detail.previousTechnicianName} → {event.detail.technicianName||'待派工'}</p>:null}
      {['accept','record-parts','edit-parts','confirm-parts','issue-parts'].includes(event.action)&&event.detail.partsRequirement?<PartsRequirementSummary value={event.detail.partsRequirement}/>:null}
      {['record-hours','inspect'].includes(event.action)&&event.detail.workHours!==undefined?<p>实际工时：{event.detail.previousWorkHours!==undefined?`${event.detail.previousWorkHours} → `:''}{event.detail.workHours} 小时</p>:null}
      {event.detail.itemId?<p>项目：{task.items.find(i=>i.id===event.detail.itemId)?.name||event.detail.itemId}</p>:null}
      {event.action==='reopen-repair'?<p>本次项目：{event.detail.items?.map(i=>i.name).join('、')}</p>:null}
      <RepairProjectChanges event={event}/>
      {event.detail.rejectedItemIds?.length?<p>退回项目：{event.detail.rejectedItemIds.map(id=>task.items.find(i=>i.id===id)?.name||id).join('、')}</p>:null}
      {event.detail.dueAt?<p>预计完工：{event.action==='update-due'?`${displayTime(event.detail.previousDueAt)} → `:''}{displayTime(event.detail.dueAt)}{event.detail.urgent?' · 加急':''}</p>:null}
      {event.detail.pauseReason?<p>{event.detail.pauseReason}</p>:null}
      {event.detail.reason?<p>{event.detail.reason}</p>:null}{event.detail.note?<p>{event.detail.note}</p>:null}</div>}))}/>
    </>}]} />
    {actions.length?<div ref={setActionBar} className="task-detail-actions"><div ref={setProjectActionsTarget} className="project-actions-slot"/><Space wrap>{actions.map(action=><Button key={action} type={['reopen-repair','assign','accept','submit','inspect','claim-inspection'].includes(action)?'primary':'default'} loading={controller.busy} disabled={controller.busy||photoBlocked||action==='inspect'&&!inspectionDraft.complete} onClick={()=>{
      if(action==='inspect'){if(!inspectionDraft.complete){controller.setError('请先为每个待检项目选择通过或退回');return;}setInspectionReview({version:task.version,choices:{...inspectionDraft.choices}});setDialog(action);}
      else if(action==='accept')setPartsDialog(true);else if(['resume','reoffer','remind','claim-inspection','retry-inspection-notifications'].includes(action)) void controller.act({action});else setDialog(action);
    }}>{action==='inspect'?(inspectionDraft.complete?`提交检验结果（通过 ${inspectionDraft.pending.length-inspectionDraft.rejectedItemIds.length} · 退回 ${inspectionDraft.rejectedItemIds.length}）`:`还剩 ${inspectionDraft.pending.filter(item=>!inspectionDraft.choices[item.id]).length} 项未确认`):actionLabels[action]}</Button>)}</Space></div>:null}
    {partsDialog?<PartsRequirementDialog controller={controller} accepting={task.stage==='待接单'} onClose={()=>setPartsDialog(false)}/>:null}
    {dialog?<DispatchActionDialog key={`${task.orderId}-${dialog}`} action={dialog} task={task} controller={controller} inspectionReview={inspectionReview} onClose={()=>setDialog(undefined)}/>:null}
  </div>;
}
