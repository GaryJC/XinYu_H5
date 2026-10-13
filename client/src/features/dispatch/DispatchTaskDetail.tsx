import { executionLabels,executionTextFields,executionTimeFields } from './DispatchExecutionFields';
import { useState } from 'react';
import { Alert,Button,Card,Collapse,Descriptions,Empty,Space,Tag,Timeline } from 'antd';
import type { DispatchActionName,UserProfile } from '../../../../shared/types';
import { AuthenticatedImage } from '../../shared/ui/AuthenticatedImage';
import { requestBlob } from '../../shared/api/httpClient';
import type { DispatchController } from './useDispatchController';
import { actionLabels,displayTime,notificationLabels,taskStatusLabel } from './dispatchLabels';
import { DispatchActionDialog } from './DispatchActionDialog';
export function DispatchTaskDetail({controller,user}:{controller:DispatchController;user:UserProfile}) {
  const [dialog,setDialog]=useState<DispatchActionName>();
  const detail=controller.detail;
  if(!detail) return <>{controller.error?<Alert type="error" title={controller.error}/>:null}<Empty description="正在加载任务，或当前账号已无权访问"/></>;
  const {task,events,notifications,files}=detail;
  const unsigned=['草稿','待客户签字'].includes(task.orderStatus);
  const workers=task.technicianIds??(task.technicianId?[task.technicianId]:[]);
  const owner=task.executionMode==='outsourced'?controller.manager:workers.includes(user.id) && user.role==='technician';
  const inspect=task.stage==='待检验' && (user.role==='manager'||(user.role==='inspector'&&task.inspectorId===user.id)) && !workers.includes(user.id) && !task.participantIds?.includes(user.id) && !task.items.some(i=>i.startedBy===user.id||i.finishedBy===user.id);
  const actions:DispatchActionName[]=[];
  if(controller.manager&&!unsigned) {
    if(!task.needsReview && task.orderStatus!=='完成' && ['维修中','暂停','待检验','维修完成'].includes(task.stage)) actions.push('record-hours');
    if(task.needsReview) {if(user.role==='manager') actions.push('reconcile');}
    else {
      if(task.stage==='待派工') actions.push('assign');
      if(['待接单','待开工','维修中','暂停'].includes(task.stage)) actions.push('reassign');
      if(['待接单','待开工'].includes(task.stage)&&!task.firstStartedAt&&!task.startHistoryUnknown&&!task.items.some(i=>i.startAt||['维修中','待检验','已完工'].includes(i.status))) actions.push('cancel');
      if(task.stage==='待接单'&&task.feedback) actions.push('reoffer');
      if(task.stage!=='维修完成') actions.push('update');
    }
    if(!['待派工','维修完成'].includes(task.stage)) actions.push('remind');
  }
  if(owner&&!unsigned&&!task.needsReview) {
    if(task.stage==='待接单'&&!task.feedback) actions.push('accept','decline');
    if(['待开工','维修中'].includes(task.stage)) actions.push('pause');
    if(task.stage==='暂停') actions.push('resume');
    if(task.stage==='维修中'&&task.items.length&&task.items.every(i=>['待检验','已完工'].includes(i.status))) actions.push('submit');
  }
  if(inspect&&!unsigned&&!task.needsReview) actions.push('inspect');
  async function openFile(id:string,name:string) {
    try {const blob=await requestBlob(`/api/files/${encodeURIComponent(id)}/content`);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
    catch(e){controller.setError(e instanceof Error?e.message:'附件加载失败');}
  }
  return <div className="dispatch-detail">
    <div><Space wrap><Tag>{executionLabels[task.executionMode||'internal']}</Tag><Tag color="blue">{taskStatusLabel(task)}</Tag>{task.urgent?<Tag color="red">加急</Tag>:null}{task.overdue?<Tag color="red">超期</Tag>:null}{task.rework?<Tag color="orange">返工第 {task.reworkCount} 次</Tag>:null}</Space></div>
    {task.stage==='维修完成'&&task.orderStatus!=='完成'&&task.workHours===undefined?<Alert type="warning" showIcon title="待调度人员录入工时" description="检验已通过，请由服务顾问／派单人员录入实际工时后再完结工单。"/>:null}
    {unsigned?<Alert type="info" showIcon title="客户签字后才能派工" description="请在委托开单中完成工单与客户签字，签字后即可从派工台安排维修。"/>:null}
    {task.needsReview?<Alert type="warning" title="历史任务待核对" description="历史记录未能完整确认人员或进度；管理员核对后才能继续，不补造历史时间。"/>:null}
    {task.feedback?<Alert type="warning" title="无法接单 · 待服务顾问处理" description={task.feedback}/>:null}
    {task.stage==='暂停'?<Alert type="warning" title={`暂停：${task.pauseReason}`} description={`${task.pauseNote||''} · 自 ${displayTime(task.pausedAt)}，已暂停 ${Math.max(0,Math.floor((Date.now()-Date.parse(task.pausedAt||''))/60000))} 分钟`}/>:null}
    {controller.error?<Alert type="error" showIcon title={controller.error}/>:null}
    <Space wrap>{actions.map(action=><Button key={action} type={['assign','accept','submit','inspect'].includes(action)?'primary':'default'} loading={controller.busy} disabled={controller.busy} onClick={()=>{
      if(['accept','resume','reoffer','remind'].includes(action)) void controller.act({action});else setDialog(action);
    }}>{actionLabels[action]}</Button>)}</Space>
    <p className="dispatch-muted">{task.executionMode==='outsourced'?'承包方':'维修员工'}：{task.technicianName||"待指派"} · 预计完工：{displayTime(task.dueAt)}</p>
    <Collapse size="small" items={[{key:"info",label:"任务信息与关键时间",children:<Descriptions column={1} size="small" items={[
      {key:'number',label:'委托单',children:task.orderId},
      {key:'dispatch',label:'派工号',children:task.dispatchNo||'待业务平台回填'},
      {key:'execution',label:'执行方式',children:executionLabels[task.executionMode||'internal']},
      ...Object.entries(executionTextFields).filter(([key])=>task[key as keyof typeof executionTextFields]).map(([key,label])=>({key,label,children:task[key as keyof typeof executionTextFields]})),
      ...Object.entries(executionTimeFields).filter(([key])=>task[key as keyof typeof executionTimeFields]).map(([key,label])=>({key,label,children:displayTime(task[key as keyof typeof executionTimeFields])})),
      ...(task.executionMode==='outsourced'?[{key:'outsourcingMode',label:'外包施工方式',children:task.outsourcingMode==='offsite'?'车辆外送整包维修':'承包方到店施工'},{key:'fee',label:'约定费用',children:task.agreedFee==null?'未填写':`¥${task.agreedFee.toFixed(2)}`}]:[]),
      {key:'technician',label:task.executionMode==='outsourced'?'承包方':'维修员工',children:task.technicianName||'未指派'},
      {key:'inspector',label:'检验人',children:task.inspectorName||'未指定'},
      {key:'hours',label:'实际工时',children:task.workHours===undefined?'待调度人员填写':`${task.workHours} 小时`},
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
    <h3>维修项目 · {task.items.filter(i=>['待检验','已完工'].includes(i.status)).length}/{task.items.length} 已提报或通过</h3>
    {task.items.map(item=><Card key={item.id} size="small" title={item.name} extra={<Tag>{item.status}</Tag>}>
      <div className="dispatch-item-times"><span>开工：{displayTime(item.startAt)}</span><span>完工提报：{displayTime(item.finishAt)}</span><span>检验：{item.inspectorName||'未检验'} · {displayTime(item.inspectedAt)}</span><span>领料确认：{displayTime(item.pickedAt)}</span></div>
      {owner&&!unsigned&&!task.needsReview&&['待开工','维修中'].includes(task.stage)?<Space wrap>
        {['待开工','待派工','待领料'].includes(item.status)?<Button loading={controller.busy} disabled={controller.busy} aria-label={`开工：${item.name}`} onClick={()=>void controller.act({action:'start',itemId:item.id})}>开工</Button>:null}
        {item.status==='维修中'?<Button type="primary" loading={controller.busy} disabled={controller.busy} aria-label={`项目完成：${item.name}`} onClick={()=>void controller.act({action:'finish',itemId:item.id})}>项目完成</Button>:null}
        {!item.pickedAt?<Button loading={controller.busy} disabled={controller.busy} onClick={()=>void controller.act({action:'pick',itemId:item.id})}>确认领料</Button>:null}
      </Space>:null}
    </Card>)}
    <p className="dispatch-muted">领料仅为领取记录，不代表库存扣减；无需配件的维修可直接开工。</p>
    {files.length?<><h3>维修附件</h3><Space wrap>{files.map(file=>file.mimeType.startsWith('image/')?<AuthenticatedImage key={file.id} fileId={file.id} alt={file.originalName} width={140} height={100}/>:<Button key={file.id} onClick={()=>void openFile(file.id,file.originalName)}>{file.originalName}</Button>)}</Space></>:null}
    <h3>通知记录</h3>
    <p className="dispatch-muted">消息发送成功不代表维修工已接单。结果未知时不会自动重发。</p>
    {!notifications.length?<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无通知记录"/>:notifications.map(n=><div className="dispatch-notification" key={n.id}>
      <strong>{n.kind} · {n.recipientName}</strong><Tag color={n.status==='failed'?'red':n.status==='sent'?'green':'default'}>{notificationLabels[n.status]}</Tag>
      <span>{displayTime(n.createdAt)} · 尝试 {n.attempts} 次</span>{n.error?<span role="status">{n.error}</span>:null}
      {controller.manager&&n.status==='failed'?<Button size="small" loading={controller.busy} disabled={controller.busy} onClick={()=>void controller.act({action:'retry-notification',notificationId:n.id})}>重试通知</Button>:null}
    </div>)}
    <h3>操作与交接记录</h3>
    <Timeline items={events.map(event=>({children:<div><strong>{actionLabels[event.action as DispatchActionName]||event.action} · {event.actorName}</strong><p>{displayTime(event.at)} · {event.detail.stage}</p>
      {event.detail.previousTechnicianName&&event.detail.previousTechnicianName!==event.detail.technicianName?<p>{event.detail.previousTechnicianName} → {event.detail.technicianName||'待派工'}</p>:null}
      {event.action==='record-hours'?<p>实际工时：{event.detail.previousWorkHours!==undefined?`${event.detail.previousWorkHours} → `:''}{event.detail.workHours} 小时</p>:null}
      {event.detail.itemId?<p>项目：{task.items.find(i=>i.id===event.detail.itemId)?.name||event.detail.itemId}</p>:null}
      {event.detail.rejectedItemIds?.length?<p>退回项目：{event.detail.rejectedItemIds.map(id=>task.items.find(i=>i.id===id)?.name||id).join('、')}</p>:null}
      {event.detail.dueAt?<p>预计完工：{displayTime(event.detail.dueAt)}{event.detail.urgent?' · 加急':''}</p>:null}
      {event.detail.pauseReason?<p>{event.detail.pauseReason}</p>:null}
      {event.detail.reason?<p>{event.detail.reason}</p>:null}{event.detail.note?<p>{event.detail.note}</p>:null}</div>}))}/>
    {dialog?<DispatchActionDialog key={`${task.orderId}-${dialog}`} action={dialog} task={task} controller={controller} onClose={()=>setDialog(undefined)}/>:null}
  </div>;
}
