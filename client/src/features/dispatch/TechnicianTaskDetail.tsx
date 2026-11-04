import { TechnicianTaskHistory } from './TechnicianTaskHistory';
import { Camera, Package, Wrench } from 'lucide-react';
import { useElementHeight } from '../../shared/ui/useElementHeight';
import {VehicleNameplatePhotos,useVehicleNameplateUpload} from './VehicleNameplatePhotos';
import { OriginalRepairItems } from './OriginalRepairItems';
import { TaskDueDateEditor } from './TaskDueDateEditor';
import {partsHistoryEvents} from './partsHistory';
import {individualRepair,personalTask,partsController} from './individualRepair';
import {technicianPrimaryAction} from './technicianPrimaryAction';
import {technicianTaskStatus} from './technicianTaskStatus';
import {RepairWritebackStatus} from './RepairWritebackStatus';
import {RepairItemsEditor} from './RepairItemsEditor';
import {useRepairItemsEditor} from './useRepairItemsEditor';
import { TaskOverview } from './TaskOverview';
import './task-detail.css';
import './technician-repair.css';
import { DispatchSheetSummary } from './DispatchSheetSummary';
import { PartsRequirementDialog } from './PartsRequirementDialog';
import { PartsRequirementSummary } from './PartsRequirementSummary';
import { RepairStatusTag } from './RepairStatusTag';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Collapse, Input, Select } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import type { UserProfile } from '../../../../shared/types';
import type { DispatchController } from './useDispatchController';
import { FormDialog } from '../../shared/ui/BusinessForm';
import {canStartRepairWithParts} from '../../../../shared/repairProgress.mjs';
import {partsStatus} from './partsProgress';
import { RepairPhotoPanel } from './RepairPhotoPanel';
import { dispatchEventLabel,displayTime } from './dispatchLabels';
export function TechnicianTaskDetail({controller:c,user,onPhotoBlocked}:{controller:DispatchController;user:UserProfile;onPhotoBlocked:(blocked:boolean)=>void}) {
  const [actionBar,setActionBar]=useState<HTMLDivElement|null>(null);
  const actionBarHeight=useElementHeight(actionBar);
  const projectsRef=useRef<HTMLElement>(null),partsRef=useRef<HTMLDivElement>(null),photosRef=useRef<HTMLDivElement>(null);
  function jumpTo(element:HTMLElement|null) {
    element?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    element?.focus({preventScroll:true});
  }
  const [partsDialog,setPartsDialog]=useState(false);
  const [dialog,setDialog]=useState<'submit-order'|'pause'|'decline'>();
  const [note,setNote]=useState(''),[reason,setReason]=useState('待配件'),[repairBlocked,setBlocked]=useState(false);
  const wholeTask=c.detail!.task;
  const individual=individualRepair(wholeTask);
  const task=personalTask(wholeTask,user.id);
  const status=technicianTaskStatus(wholeTask,user.id);
  const ownController=individual?{...c,detail:{...c.detail!,task}}:c;
  const materialController=partsController(c,individual?user.id:undefined);
  const itemsEditor=useRepairItemsEditor(task,ownController);
  const canEditItems=!task.needsReview&&(task.technicianIds??[task.technicianId]).includes(user.id)&&['待开工','维修中','暂停','回审'].includes(task.stage);
  const hasRepairPhoto=c.detail!.files.some(f=>['repair_progress_photo','repair_completed_photo'].includes(f.kind)&&(f.repairRound||0)===(task.repairRound||0)&&(!individual||f.uploadedBy===user.id));
  const editable=!task.needsReview && (task.technicianIds??[task.technicianId]).includes(user.id);
  const ownDone=individual&&task.items.length>0&&task.items.every(i=>['待检验','已完工'].includes(i.status))&&Boolean(task.workerSubmissions?.[user.id]||task.stage==='待检验'||task.items.every(i=>i.status==='已完工'));
  const nameplate=useVehicleNameplateUpload(c,editable&&!ownDone&&!task.feedback&&['待接单','待开工','维修中','暂停','回审'].includes(task.stage));
  const blocked=repairBlocked||nameplate.uploading;
  const photoBlocked=useCallback((value:boolean)=>setBlocked(value),[]);
  useEffect(()=>{onPhotoBlocked(blocked);return()=>onPhotoBlocked(false);},[blocked,onPhotoBlocked]);
  const canPhoto=editable&&!ownDone&&['待开工','维修中','暂停','回审'].includes(task.stage);
  const waitingForParts=Boolean(task.partsRequirement&&task.partsRequirement.mode!=='none'&&!task.partsRequirement.issuedAt&&!task.partsRequirement.preparedAt);
  const legacyWaiting=individual&&wholeTask.partsRequirement&&wholeTask.partsRequirement.mode!=='none'&&!wholeTask.partsRequirement.issuedAt&&!wholeTask.partsRequirement.preparedAt;
  const primaryAction=technicianPrimaryAction(task,Boolean(legacyWaiting),canStartRepairWithParts(wholeTask,user.id));
  const primary=individual&&!ownDone&&task.stage==='维修中'&&task.items.some(i=>i.status==='待检验')&&!waitingForParts&&!legacyWaiting?primaryAction||'submit-order':primaryAction;
  const partsNotice=waitingForParts&&['待开工','维修中','暂停','回审'].includes(task.stage)?<Alert type="info" showIcon title={partsStatus(task.partsRequirement)==='部分备齐'?'部分备齐':'等待仓库备料'} description={task.stage==='回审'?'仓管确认本轮配件全部备齐后可提交回审。':'仓管确认本轮配件全部备齐后可提交完工。'}/>:null;
  const label=primary==='accept'?'确认接单':primary==='resume'?'继续维修':primary==='start-order'?(task.rework&&task.rejectedItemIds?.length?'开始返工':'开始维修'):task.stage==='回审'?'提交回审':individual?'提交本人完工':'提交完工';
  const handoverField=itemsEditor.handover?<label className="repair-completion-note"><span>原因 / 交接说明（必填）</span><Input.TextArea aria-label="原因或交接说明" value={itemsEditor.handoverReason} maxLength={2000} rows={3} disabled={c.busy} onChange={e=>itemsEditor.setHandoverReason(e.target.value)}/></label>:null;
  async function confirm() {
    if(dialog==='submit-order') {if(!hasRepairPhoto||blocked)return;if(await itemsEditor.save(true,note))setDialog(undefined);}
    if(dialog==='pause') {if(await c.act({action:dialog,pauseReason:reason,note}))setDialog(undefined);}
    if(dialog==='decline') {if(await c.act({action:dialog,reason:reason==='其他'?note:reason}))setDialog(undefined);}
  }
  return <div className="technician-detail" style={{paddingBottom:actionBar?Math.max(24,actionBarHeight+16):0}}>
    <RepairWritebackStatus controller={c}/>
    <TaskOverview task={task} dueEditor={<TaskDueDateEditor key={`${task.orderId}-${user.id}`} controller={c} user={user} blocked={blocked} />}><RepairStatusTag status={status}/></TaskOverview>
    <nav className="technician-detail-nav" aria-label="维修详情快捷定位">
      <Button icon={<Wrench size={16} aria-hidden="true"/>} onClick={()=>jumpTo(projectsRef.current)}>维修项目</Button>
      <Button icon={<Package size={16} aria-hidden="true"/>} onClick={()=>jumpTo(partsRef.current)}>所需配件</Button>
      <Button icon={<Camera size={16} aria-hidden="true"/>} onClick={()=>jumpTo(photosRef.current)}>维修照片</Button>
    </nav>
    {c.error?<Alert type="error" showIcon title={c.error}/>:null}
    {individual&&editable&&!task.items.length?<Alert type="info" showIcon title="尚未登记本人维修项目" description="可先申请本人配件，点击编辑项目补录本人负责的作业后，再提交本人完工。"/>:null}
    {task.needsReview?<Alert type="warning" title="请联系服务顾问核对任务后再维修"/>:null}
    {task.feedback?<Alert type="warning" title="已反馈无法接单，等待服务顾问处理" description={task.feedback}/>:null}
    {task.stage==='暂停'?<Alert type="warning" title={`暂停：${task.pauseReason}`} description={task.pauseNote}/>:null}
    {task.repairRound&&task.rework&&['待开工','维修中','暂停'].includes(task.stage)&&task.rejectedItemIds?.length?<Alert type="error" showIcon title="本轮检验退回，请重新维修指定项目" description={task.reworkReason}/>:null}
    {task.rework&&!task.repairRound&&['待开工','维修中','暂停'].includes(task.stage)?<Alert type="warning" title="需要返工" description={task.reworkReason||'请查看退回维修项目'}/>:null}
    {task.stage==='回审'?<Alert type="warning" showIcon title="检验单已发送回审，请核对并编辑维修项目后提交回审"/>:null}
    {status==='待检验'?<Alert type="info" title={task.inspectorName?`${task.inspectorName}已接手${task.rejectedItemIds?.length?'复检':'检验'}`:task.rejectedItemIds?.length?'返工已提交，等待检验员领取复检':'已提交，等待检验员领取'}/>:null}
    {partsNotice}
    {legacyWaiting?<Alert type="info" title="历史共同配件尚未全部备齐"/>:null}

    <section ref={projectsRef} tabIndex={-1} className="technician-section-anchor technician-projects" aria-label="维修项目"><div className="repair-items-heading"><h3>{individual?'本人负责项目':'主要作业与增修项目'}</h3>{canEditItems&&!itemsEditor.editing?<Button icon={<EditOutlined/>} disabled={c.busy||blocked} onClick={itemsEditor.begin}>编辑项目</Button>:null}</div>
      <RepairItemsEditor compact technicians={(task.executionMode==='outsourced'?c.people.contractors:c.people.technicians).filter(p=>individual?p.id===user.id:(task.technicianIds??[task.technicianId]).includes(p.id))} items={task.items} rows={itemsEditor.editing&&dialog!=='submit-order'?itemsEditor.rows:task.items} onChange={itemsEditor.setRows} editing={itemsEditor.editing&&dialog!=='submit-order'} disabled={c.busy}/>
      {itemsEditor.editing&&dialog!=='submit-order'?<>{handoverField}<div className="repair-items-save"><Button disabled={c.busy} onClick={itemsEditor.cancel}>取消</Button><Button type="primary" loading={c.busy} disabled={!itemsEditor.valid||itemsEditor.stale||blocked} onClick={()=>void itemsEditor.save()}>保存项目</Button></div>{itemsEditor.stale?<Alert type="warning" title="工单已更新，请重新载入项目后编辑" action={<Button onClick={itemsEditor.begin}>重新载入</Button>}/>:null}</>:null}
    </section>
    <OriginalRepairItems detail={c.detail!}/>
    {task.faultDescription?<section><h3>故障描述</h3><p>{task.faultDescription}</p></section>:null}
    {task.note?<section><h3>派工备注</h3><p>{task.note}</p></section>:null}
    <div ref={partsRef} tabIndex={-1} className="technician-section-anchor technician-materials" role="region" aria-label="配件与领料">
    <PartsRequirementSummary value={task.partsRequirement}/>
    {editable&&!ownDone&&['待开工','维修中','暂停','回审'].includes(task.stage)?<Button size="large" icon={<Package size={16} aria-hidden="true"/>} block disabled={c.busy||blocked} onClick={()=>setPartsDialog(true)}>{(task.partsRequirement?.issuedAt||task.partsRequirement?.preparedAt)?'追加配件申请':task.partsRequirement?'编辑所需配件':'向仓库申请领料'}</Button>:null}
    </div>
    <Collapse className="technician-parts-history" items={[{key:'parts-history',label:'配件申请与备料记录',children:partsHistoryEvents(c.detail!.events).filter(e=>['accept','record-parts','edit-parts','confirm-parts','issue-parts'].includes(e.action)&&e.detail.partsRequirement).map(e=><section key={e.id} className="technician-parts-history-entry"><header className="technician-parts-history-meta"><time>{displayTime(e.at)}</time><span>{e.actorName} · {dispatchEventLabel(e)}</span></header><PartsRequirementSummary value={e.detail.partsRequirement}/></section>)}]}/>

    {individual?<Collapse items={[{key:'team',label:'全单项目进度',children:<RepairItemsEditor compact items={wholeTask.items} rows={wholeTask.items} onChange={()=>{}}/>}]}/>:null}
    <div ref={photosRef} tabIndex={-1} className="technician-section-anchor technician-photo-section" role="region" aria-label="维修拍照与记录">
    <RepairPhotoPanel controller={c} ownerId={individual?user.id:undefined} editable={canPhoto&&!nameplate.uploading} onBlocked={photoBlocked}/>
    </div>
    <VehicleNameplatePhotos currentId={wholeTask.vehicleNameplateFileId} files={c.detail!.files} onUpload={editable&&!ownDone&&!task.feedback&&['待接单','待开工','维修中','暂停','回审'].includes(task.stage)?nameplate.upload:undefined} disabled={c.busy||blocked} uploading={nameplate.uploading} error={nameplate.error} historyLoading={nameplate.historyLoading} historyError={nameplate.historyError} onReloadHistory={nameplate.reloadHistory}/>
    <Collapse items={[{key:"sheet",label:"完整派工单与接车照片",children:<DispatchSheetSummary task={task} files={c.detail!.files}/>}]} />
    <Collapse className="technician-more-info" items={[{key:'more',label:'更多信息',children:<TechnicianTaskHistory detail={c.detail!}/>}]} />
    {!ownDone&&(primary||['待开工','维修中','回审'].includes(task.stage))&&editable&&!task.needsReview?<div ref={setActionBar} className="technician-action-bar"><div className="technician-action-buttons">
      {['待接单','待开工','维修中'].includes(task.stage)?<Button className={task.stage==='待接单'?'repair-decline-button':'repair-pause-button'} danger={task.stage==='待接单'} color={task.stage==='待接单'?'danger':'orange'} variant="outlined" onClick={()=>{setNote('');setReason(task.stage==='待接单'?'时间冲突':'待配件');setDialog(task.stage==='待接单'?'decline':'pause');}} disabled={c.busy||blocked||Boolean(task.feedback)}>{task.stage==='待接单'?'无法接单':'暂停维修'}</Button>:null}
      {waitingForParts&&['待开工','维修中','回审'].includes(task.stage)?<Button type="primary" block disabled>{task.stage==='回审'?'提交回审':'提交完工'}</Button>:null}
      {primary?<Button type="primary" block loading={c.busy} disabled={c.busy||blocked||itemsEditor.editing} onClick={()=>{if(primary==='accept'){setPartsDialog(true);}else if(primary==='submit-order'){itemsEditor.begin();setNote('');setDialog(primary);}else void c.act({action:primary});}}>{label}</Button>:null}</div>{waitingForParts?<span role="status">本轮配件尚未备齐，暂不能{task.stage==='回审'?'提交回审':'提交完工'}</span>:null}{blocked?<span>请等待照片上传完成，或处理失败照片</span>:null}</div>:null}
    {partsDialog?<PartsRequirementDialog controller={materialController} accepting={task.stage==='待接单'} onUploading={photoBlocked} onClose={()=>setPartsDialog(false)}/>:null}
    {dialog?<FormDialog open className="technician-completion-dialog" title={dialog==='submit-order'?(task.stage==='回审'?'确认提交回审？':'确认维修完成？'):dialog==='pause'?'暂停维修':'无法接单'} okText={dialog==='submit-order'?(task.stage==='回审'?'提交回审':'确认提交'):'确认'} onOk={()=>void confirm()} confirmLoading={c.busy} okButtonProps={{disabled:dialog==='submit-order'&&(!hasRepairPhoto||blocked||!itemsEditor.valid||itemsEditor.stale||primary!=='submit-order')}} onCancel={()=>{if(!c.busy){setDialog(undefined);itemsEditor.cancel();}}} cancelButtonProps={{disabled:c.busy}} closable={!c.busy} mask={{closable:false}}>
      {dialog!=='submit-order'?<Select aria-label="问题原因" style={{width:'100%',marginBottom:16}} value={reason} onChange={setReason} options={(dialog==='pause'?['待配件','待客户确认','技术问题','其他']:['时间冲突','无法维修此项目','其他']).map(value=>({value,label:value}))}/>:null}
      {dialog==='submit-order'?<section><h3>{individual?'本人负责项目':'主要作业与增修项目'}</h3><RepairItemsEditor technicians={(task.executionMode==='outsourced'?c.people.contractors:c.people.technicians).filter(p=>individual?p.id===user.id:(task.technicianIds??[task.technicianId]).includes(p.id))} items={task.items} rows={itemsEditor.rows} onChange={itemsEditor.setRows} editing disabled={c.busy}/>{itemsEditor.stale?<Alert type="warning" title="工单已更新，请重新载入项目后编辑" action={<Button onClick={itemsEditor.begin}>重新载入</Button>}/>:null}</section>:null}
      {dialog==='submit-order'?handoverField:null}
      {dialog==='submit-order'&&primary==='start-order'?<Alert type="warning" showIcon title="请先返回并点击开始返工，仅需重新开工未通过的项目"/>:null}
      {dialog==='submit-order'&&!hasRepairPhoto?<Alert type="warning" showIcon title="请先返回并上传本轮维修照片"/>:null}
      {dialog==='submit-order'||reason==='其他'?<label className="repair-completion-note"><span>{dialog==='submit-order'?'完工说明（选填）':'问题说明'}</span><Input.TextArea aria-label={dialog==='submit-order'?'完工说明（选填）':'问题说明'} placeholder={dialog==='submit-order'?'填写维修结果或注意事项':'请说明原因'} rows={3} maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></label>:null}
      {c.error?<Alert type="error" title={c.error}/>:null}
    </FormDialog>:null}
  </div>;
}
