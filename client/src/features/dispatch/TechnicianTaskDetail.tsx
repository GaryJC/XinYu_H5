import { OriginalRepairItems } from './OriginalRepairItems';
import { TaskDueDateEditor } from './TaskDueDateEditor';
import {partsHistoryEvents} from './partsHistory';
import {individualRepair,personalTask,partsController} from './individualRepair';
import {technicianPrimaryAction} from './technicianPrimaryAction';
import {RepairWritebackStatus} from './RepairWritebackStatus';
import {RepairItemsEditor} from './RepairItemsEditor';
import {useRepairItemsEditor} from './useRepairItemsEditor';
import { TaskOverview } from './TaskOverview';
import './task-detail.css';
import { DispatchSheetSummary } from './DispatchSheetSummary';
import { PartsRequirementDialog } from './PartsRequirementDialog';
import { PartsRequirementSummary } from './PartsRequirementSummary';
import { RepairStatusTag } from './RepairStatusTag';
import { useCallback, useState } from 'react';
import { Alert, Button, Collapse, Input, Select } from 'antd';
import type { UserProfile } from '../../../../shared/types';
import type { DispatchController } from './useDispatchController';
import { FormDialog } from '../../shared/ui/BusinessForm';
import { RepairPhotoPanel } from './RepairPhotoPanel';
import { dispatchEventLabel,displayTime,taskStatusLabel } from './dispatchLabels';
export function TechnicianTaskDetail({controller:c,user,onPhotoBlocked}:{controller:DispatchController;user:UserProfile;onPhotoBlocked:(blocked:boolean)=>void}) {
  const [partsDialog,setPartsDialog]=useState(false);
  const [dialog,setDialog]=useState<'submit-order'|'pause'|'decline'>();
  const [note,setNote]=useState(''),[reason,setReason]=useState('待配件'),[blocked,setBlocked]=useState(false);
  const photoBlocked=useCallback((value:boolean)=>{setBlocked(value);onPhotoBlocked(value);},[onPhotoBlocked]);
  const wholeTask=c.detail!.task;
  const individual=individualRepair(wholeTask);
  const task=personalTask(wholeTask,user.id);
  const ownController=individual?{...c,detail:{...c.detail!,task}}:c;
  const materialController=partsController(c,individual?user.id:undefined);
  const itemsEditor=useRepairItemsEditor(task,ownController);
  const canEditItems=!task.needsReview&&(task.technicianIds??[task.technicianId]).includes(user.id)&&['待开工','维修中','暂停','回审'].includes(task.stage);
  const hasRepairPhoto=c.detail!.files.some(f=>f.kind==='repair_progress_photo'&&(f.repairRound||0)===(task.repairRound||0)&&(!individual||f.uploadedBy===user.id));
  const editable=!task.needsReview && (task.technicianIds??[task.technicianId]).includes(user.id);
  const ownDone=individual&&task.items.length>0&&task.items.every(i=>['待检验','已完工'].includes(i.status))&&Boolean(task.workerSubmissions?.[user.id]||task.stage==='待检验'||task.items.every(i=>i.status==='已完工'));
  const canPhoto=editable&&!ownDone&&['待开工','维修中','暂停','回审'].includes(task.stage);
  const waitingForParts=Boolean(task.partsRequirement&&task.partsRequirement.mode!=='none'&&!task.partsRequirement.issuedAt&&!task.partsRequirement.preparedAt);
  const legacyWaiting=individual&&wholeTask.partsRequirement&&wholeTask.partsRequirement.mode!=='none'&&!wholeTask.partsRequirement.issuedAt&&!wholeTask.partsRequirement.preparedAt;
  const primary=legacyWaiting?undefined:individual&&!ownDone&&task.stage==='维修中'&&task.items.some(i=>i.status==='待检验')&&!waitingForParts?technicianPrimaryAction(task)||'submit-order':technicianPrimaryAction(task);
  const partsNotice=waitingForParts&&['待开工','维修中','暂停','回审'].includes(task.stage)?<Alert type="info" showIcon title={task.partsRequirement?.preparedAt?'配件已备齐，请到仓库领取':'等待仓库备料'} description={task.stage==='回审'?'仓管确认本轮配件全部备齐后可提交回审。':'仓管确认本轮配件全部备齐后可提交完工。'}/>:null;
  const label=task.stage==='回审'?'提交回审':primary==='accept'?'确认接单':primary==='resume'?'继续维修':primary==='start-order'?(task.rework&&task.rejectedItemIds?.length?'开始返工':'开始维修'):individual?'提交本人完工':'提交完工';
  const handoverField=itemsEditor.handover?<label className="repair-completion-note"><span>原因 / 交接说明（必填）</span><Input.TextArea aria-label="原因或交接说明" value={itemsEditor.handoverReason} maxLength={2000} rows={3} disabled={c.busy} onChange={e=>itemsEditor.setHandoverReason(e.target.value)}/></label>:null;
  async function confirm() {
    if(dialog==='submit-order') {if(!hasRepairPhoto||blocked)return;if(await itemsEditor.save(true,note))setDialog(undefined);}
    if(dialog==='pause') {if(await c.act({action:dialog,pauseReason:reason,note}))setDialog(undefined);}
    if(dialog==='decline') {if(await c.act({action:dialog,reason:reason==='其他'?note:reason}))setDialog(undefined);}
  }
  return <div className="technician-detail">
    <RepairWritebackStatus controller={c}/>
    <TaskOverview task={task} dueEditor={<TaskDueDateEditor key={`${task.orderId}-${user.id}`} controller={c} user={user} blocked={blocked} />}><RepairStatusTag status={taskStatusLabel(task)}/></TaskOverview>
    {c.error?<Alert type="error" showIcon title={c.error}/>:null}
    {task.needsReview?<Alert type="warning" title="请联系服务顾问核对任务后再维修"/>:null}
    {task.feedback?<Alert type="warning" title="已反馈无法接单，等待服务顾问处理" description={task.feedback}/>:null}
    {task.stage==='暂停'?<Alert type="warning" title={`暂停：${task.pauseReason}`} description={task.pauseNote}/>:null}
    {task.repairRound&&task.rework&&['待开工','维修中','暂停'].includes(task.stage)&&task.rejectedItemIds?.length?<Alert type="error" showIcon title="本轮检验退回，请重新维修指定项目" description={task.reworkReason}/>:null}
    {task.rework&&!task.repairRound&&['待开工','维修中','暂停'].includes(task.stage)?<Alert type="warning" title="需要返工" description={task.reworkReason||'请查看退回维修项目'}/>:null}
    {task.stage==='回审'?<Alert type="warning" showIcon title="检验单已发送回审，请核对并编辑维修项目后提交回审"/>:null}
    {task.stage==='待检验'?<Alert type="info" title={task.inspectorName?`${task.inspectorName}已接手${task.rejectedItemIds?.length?'复检':'检验'}`:task.rejectedItemIds?.length?'返工已提交，等待检验员领取复检':'已提交，等待检验员领取'}/>:null}
    {partsNotice}
    {legacyWaiting?<Alert type="info" title="历史共同配件尚未备齐，请等待仓库确认"/>:null}
    {individual&&!task.items.length?<Alert type="info" title="尚未分配本人项目，请联系服务顾问"/>:null}
    {individual&&task.items.length>0&&task.items.every(i=>['待检验','已完工'].includes(i.status))&&wholeTask.stage!=='待检验'?<Alert type="success" title="本人项目已提交，等待其他维修工完成"/>:null}
    <section><div className="repair-items-heading"><h3>{individual?'本人负责项目':'主要作业与增修项目'}</h3>{canEditItems&&!itemsEditor.editing?<Button disabled={c.busy||blocked} onClick={itemsEditor.begin}>编辑项目</Button>:null}</div>
      <RepairItemsEditor technicians={(task.executionMode==='outsourced'?c.people.contractors:c.people.technicians).filter(p=>individual?p.id===user.id:(task.technicianIds??[task.technicianId]).includes(p.id))} items={task.items} rows={itemsEditor.editing&&dialog!=='submit-order'?itemsEditor.rows:task.items} onChange={itemsEditor.setRows} editing={itemsEditor.editing&&dialog!=='submit-order'} disabled={c.busy}/>
      {itemsEditor.editing&&dialog!=='submit-order'?<>{handoverField}<div className="repair-items-save"><Button disabled={c.busy} onClick={itemsEditor.cancel}>取消</Button><Button type="primary" loading={c.busy} disabled={!itemsEditor.valid||itemsEditor.stale||blocked} onClick={()=>void itemsEditor.save()}>保存项目</Button></div>{itemsEditor.stale?<Alert type="warning" title="工单已更新，请重新载入项目后编辑" action={<Button onClick={itemsEditor.begin}>重新载入</Button>}/>:null}</>:null}
    </section>
    <OriginalRepairItems detail={c.detail!}/>
    {task.faultDescription?<section><h3>故障描述</h3><p>{task.faultDescription}</p></section>:null}
    {task.note?<section><h3>派工备注</h3><p>{task.note}</p></section>:null}
    <PartsRequirementSummary value={task.partsRequirement}/>
    <Collapse items={[{key:'parts-history',label:'配件申请与备料记录',children:partsHistoryEvents(c.detail!.events).filter(e=>['accept','record-parts','edit-parts','confirm-parts','issue-parts'].includes(e.action)&&e.detail.partsRequirement).map(e=><section key={e.id}><p>{displayTime(e.at)} · {e.actorName} · {dispatchEventLabel(e)}</p><PartsRequirementSummary value={e.detail.partsRequirement}/></section>)}]}/>

    {editable&&!ownDone&&task.items.length>0&&!(task.partsRequirement?.items.some(i=>i.issuedAt||i.preparedAt)&&!task.partsRequirement.issuedAt&&!task.partsRequirement.preparedAt)&&['待开工','维修中','暂停','回审'].includes(task.stage)?<Button block disabled={c.busy||blocked} onClick={()=>setPartsDialog(true)}>{(task.partsRequirement?.issuedAt||task.partsRequirement?.preparedAt)?"追加配件申请":"向仓库申请领料"}</Button>:null}
    {individual?<Collapse items={[{key:'team',label:'全单项目进度',children:wholeTask.items.map(item=><p key={item.id}>{item.name} · {item.responsibleName||'未分配'} · {item.status}</p>)}]}/>:null}
    <RepairPhotoPanel controller={c} ownerId={individual?user.id:undefined} editable={canPhoto} onBlocked={photoBlocked}/>
    <Collapse items={[{key:"sheet",label:"完整派工单与接车照片",children:<DispatchSheetSummary task={task} files={c.detail!.files}/>}]} />
    <Collapse items={[{key:'more',label:'更多信息',children:<><p>委托单：{task.orderId}</p><p>接单：{displayTime(task.acceptedAt)}</p><p>开工：{displayTime(task.firstStartedAt)}</p>{c.detail!.events.map(e=><p key={e.id}>{displayTime(e.at)} · {e.actorName} · {dispatchEventLabel(e)} · {e.detail.stage}{e.action==='update-due'?` · 预计完工：${displayTime(e.detail.previousDueAt)} → ${displayTime(e.detail.dueAt)}`:''}{e.detail.reason?` · ${e.detail.reason}`:''}</p>)}</>}]} />
    {!ownDone&&(primary||['待开工','维修中','回审'].includes(task.stage))&&editable&&!task.needsReview?<div className="technician-action-bar"><div className="technician-action-buttons">
      {['待接单','待开工','维修中'].includes(task.stage)?<Button className={task.stage==='待接单'?'repair-decline-button':'repair-pause-button'} danger={task.stage==='待接单'} color={task.stage==='待接单'?'danger':'orange'} variant="outlined" onClick={()=>{setNote('');setReason(task.stage==='待接单'?'时间冲突':'待配件');setDialog(task.stage==='待接单'?'decline':'pause');}} disabled={c.busy||blocked||Boolean(task.feedback)}>{task.stage==='待接单'?'无法接单':'暂停维修'}</Button>:null}
      {waitingForParts&&['待开工','维修中','回审'].includes(task.stage)?<Button type="primary" block disabled>{task.stage==='回审'?'提交回审':'提交完工'}</Button>:null}
      {primary?<Button type="primary" block loading={c.busy} disabled={c.busy||blocked||itemsEditor.editing} onClick={()=>{if(primary==='accept'){setPartsDialog(true);}else if(primary==='submit-order'){itemsEditor.begin();setNote('');setDialog(primary);}else void c.act({action:primary});}}>{label}</Button>:null}</div>{waitingForParts?<span role="status">本轮配件尚未备齐，暂不能{task.stage==='回审'?'提交回审':'提交完工'}</span>:null}{blocked?<span>请等待照片上传完成，或处理失败照片</span>:null}</div>:null}
    {partsDialog?<PartsRequirementDialog controller={materialController} accepting={task.stage==='待接单'} onUploading={photoBlocked} onClose={()=>setPartsDialog(false)}/>:null}
    {dialog?<FormDialog open className="technician-completion-dialog" title={dialog==='submit-order'?(task.stage==='回审'?'确认提交回审？':'确认维修完成？'):dialog==='pause'?'暂停维修':'无法接单'} okText={dialog==='submit-order'?(task.stage==='回审'?'提交回审':'确认提交'):'确认'} onOk={()=>void confirm()} confirmLoading={c.busy} okButtonProps={{disabled:dialog==='submit-order'&&(!hasRepairPhoto||blocked||!itemsEditor.valid||itemsEditor.stale||primary!=='submit-order')}} onCancel={()=>{if(!c.busy){setDialog(undefined);itemsEditor.cancel();}}} cancelButtonProps={{disabled:c.busy}} closable={!c.busy} mask={{closable:false}}>
      {dialog==='submit-order'?<p>{individual?'提交前须上传至少一张本人本轮维修照片。只提交本人负责项目，全部维修工完成后统一交检。':'提交前须上传至少一张本轮维修照片，完工说明选填。提交后由检验员检查。'}</p>:<Select aria-label="问题原因" style={{width:'100%',marginBottom:16}} value={reason} onChange={setReason} options={(dialog==='pause'?['待配件','待客户确认','技术问题','其他']:['时间冲突','无法维修此项目','其他']).map(value=>({value,label:value}))}/>}
      {dialog==='submit-order'?<section><h3>{individual?'本人负责项目':'主要作业与增修项目'}</h3><RepairItemsEditor technicians={(task.executionMode==='outsourced'?c.people.contractors:c.people.technicians).filter(p=>individual?p.id===user.id:(task.technicianIds??[task.technicianId]).includes(p.id))} items={task.items} rows={itemsEditor.rows} onChange={itemsEditor.setRows} editing disabled={c.busy}/>{itemsEditor.stale?<Alert type="warning" title="工单已更新，请重新载入项目后编辑" action={<Button onClick={itemsEditor.begin}>重新载入</Button>}/>:null}</section>:null}
      {dialog==='submit-order'?handoverField:null}
      {dialog==='submit-order'&&primary==='start-order'?<Alert type="warning" showIcon title="请先返回并点击开始返工，仅需重新开工未通过的项目"/>:null}
      {dialog==='submit-order'&&!hasRepairPhoto?<Alert type="warning" showIcon title="请先返回并上传本轮维修照片"/>:null}
      {dialog==='submit-order'||reason==='其他'?<label className="repair-completion-note"><span>{dialog==='submit-order'?'完工说明（选填）':'问题说明'}</span><Input.TextArea aria-label={dialog==='submit-order'?'完工说明（选填）':'问题说明'} placeholder={dialog==='submit-order'?'填写维修结果或注意事项':'请说明原因'} rows={3} maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></label>:null}
      {c.error?<Alert type="error" title={c.error}/>:null}
    </FormDialog>:null}
  </div>;
}
