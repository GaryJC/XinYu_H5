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
  const task=c.detail!.task;
  const itemsEditor=useRepairItemsEditor(task,c);
  const canEditItems=!task.needsReview&&(task.technicianIds??[task.technicianId]).includes(user.id)&&['待开工','维修中','暂停'].includes(task.stage);
  const hasRepairPhoto=c.detail!.files.some(f=>f.kind==='repair_progress_photo'&&(f.repairRound||0)===(task.repairRound||0));
  const editable=!task.needsReview && (task.technicianIds??[task.technicianId]).includes(user.id);
  const canPhoto=editable&&['待开工','维修中','暂停'].includes(task.stage);
  const waitingForParts=Boolean(task.partsRequirement&&task.partsRequirement.mode!=='none'&&!task.partsRequirement.issuedAt);
  const primary=task.stage==='待接单'&&!task.feedback?'accept':task.stage==='暂停'?'resume':task.stage==='待开工'&&!waitingForParts?'start-order':task.stage==='维修中'&&!waitingForParts?'submit-order':undefined;
  const label=primary==='accept'?'确认接单':primary==='resume'?'继续维修':primary==='start-order'?'开始维修':'提交完工';
  async function confirm() {
    if(dialog==='submit-order') {if(!hasRepairPhoto||blocked)return;if(await itemsEditor.save(true,note))setDialog(undefined);}
    if(dialog==='pause') {if(await c.act({action:dialog,pauseReason:reason,note}))setDialog(undefined);}
    if(dialog==='decline') {if(await c.act({action:dialog,reason:reason==='其他'?note:reason}))setDialog(undefined);}
  }
  return <div className="technician-detail">
    <TaskOverview task={task}><RepairStatusTag status={taskStatusLabel(task)}/></TaskOverview>
    {c.error?<Alert type="error" showIcon title={c.error}/>:null}
    {task.needsReview?<Alert type="warning" title="请联系服务顾问核对任务后再维修"/>:null}
    {task.feedback?<Alert type="warning" title="已反馈无法接单，等待服务顾问处理" description={task.feedback}/>:null}
    {task.stage==='暂停'?<Alert type="warning" title={`暂停：${task.pauseReason}`} description={task.pauseNote}/>:null}
    {task.repairRound?<Alert type="warning" showIcon title={`返工第 ${task.repairRound} 轮`} description={task.roundReason}/>:null}
    {task.repairRound&&task.rework&&task.rejectedItemIds?.length?<Alert type="error" showIcon title="本轮检验退回，请重新维修指定项目" description={task.reworkReason}/>:null}
    {task.rework&&!task.repairRound?<Alert type="warning" title="需要返工" description={task.reworkReason||'请查看退回维修项目'}/>:null}
    {task.stage==='待检验'?<Alert type="info" title={task.inspectorName?`${task.inspectorName}已接手检验`:'已提交，等待检验员领取'}/>:null}
    <section><div className="repair-items-heading"><h3>主要作业与增修项目</h3>{canEditItems&&!itemsEditor.editing?<Button disabled={c.busy||blocked} onClick={itemsEditor.begin}>编辑项目</Button>:null}</div>
      <RepairItemsEditor items={task.items} rows={itemsEditor.editing&&dialog!=='submit-order'?itemsEditor.rows:task.items} onChange={itemsEditor.setRows} editing={itemsEditor.editing&&dialog!=='submit-order'} disabled={c.busy} rejectedItemIds={task.rejectedItemIds}/>
      {itemsEditor.editing&&dialog!=='submit-order'?<><div className="repair-items-save"><Button disabled={c.busy} onClick={itemsEditor.cancel}>取消</Button><Button type="primary" loading={c.busy} disabled={!itemsEditor.valid||itemsEditor.stale||blocked} onClick={()=>void itemsEditor.save()}>保存项目</Button></div>{itemsEditor.stale?<Alert type="warning" title="工单已更新，请重新载入项目后编辑" action={<Button onClick={itemsEditor.begin}>重新载入</Button>}/>:null}</>:null}
    </section>
    {task.faultDescription?<section><h3>故障描述</h3><p>{task.faultDescription}</p></section>:null}
    {task.note?<section><h3>派工备注</h3><p>{task.note}</p></section>:null}
    {task.stage==='待开工'&&waitingForParts?<Alert type="info" showIcon title={task.partsRequirement?.preparedAt?'配件已备齐，请到仓库领取':'已接单，等待仓库备料'} description="交接时由仓管确认出库，系统将自动开始维修。"/>:null}
    {task.stage==='维修中'&&waitingForParts?<Alert type="info" showIcon title={task.partsRequirement?.preparedAt?'追加配件已备齐，请到仓库领取':'追加配件等待仓库备料'} description="维修进度保持维修中，本次配件出库后可提交完工。"/>:null}
    <PartsRequirementSummary value={task.partsRequirement}/>
    <Collapse items={[{key:'parts-history',label:'配件申请与出库记录',children:c.detail!.events.filter(e=>['accept','record-parts','edit-parts','confirm-parts','issue-parts'].includes(e.action)&&e.detail.partsRequirement).map(e=><section key={e.id}><p>{displayTime(e.at)} · {e.actorName} · {dispatchEventLabel(e)}</p><PartsRequirementSummary value={e.detail.partsRequirement}/></section>)}]}/>

    {editable&&['待开工','维修中','暂停'].includes(task.stage)?<Button block disabled={c.busy||blocked} onClick={()=>setPartsDialog(true)}>{task.partsRequirement?.issuedAt?"追加配件申请":"补充／修改配件需求"}</Button>:null}
    <RepairPhotoPanel controller={c} editable={canPhoto} onBlocked={photoBlocked}/>
    <Collapse items={[{key:"sheet",label:"完整派工单与接车照片",children:<DispatchSheetSummary task={task} files={c.detail!.files}/>}]} />
    <Collapse items={[{key:'more',label:'更多信息',children:<><p>委托单：{task.orderId}</p><p>接单：{displayTime(task.acceptedAt)}</p><p>开工：{displayTime(task.firstStartedAt)}</p>{c.detail!.events.map(e=><p key={e.id}>{displayTime(e.at)} · {e.actorName} · {dispatchEventLabel(e)} · {e.detail.stage}{e.detail.reason?` · ${e.detail.reason}`:''}</p>)}</>}]} />
    {(primary||['待开工','维修中'].includes(task.stage))&&editable&&!task.needsReview?<div className="technician-action-bar"><div className="technician-action-buttons">
      {['待接单','待开工','维修中'].includes(task.stage)?<Button className={task.stage==='待接单'?'repair-decline-button':'repair-pause-button'} danger={task.stage==='待接单'} color={task.stage==='待接单'?'danger':'orange'} variant="outlined" onClick={()=>{setNote('');setReason(task.stage==='待接单'?'时间冲突':'待配件');setDialog(task.stage==='待接单'?'decline':'pause');}} disabled={c.busy||blocked||Boolean(task.feedback)}>{task.stage==='待接单'?'无法接单':'暂停维修'}</Button>:null}
      {primary?<Button type="primary" block loading={c.busy} disabled={c.busy||blocked||itemsEditor.editing} onClick={()=>{if(primary==='accept'){setPartsDialog(true);}else if(primary==='submit-order'){itemsEditor.begin();setNote('');setDialog(primary);}else void c.act({action:primary});}}>{label}</Button>:null}</div>{blocked?<span>请等待照片上传完成，或处理失败照片</span>:null}</div>:null}
    {partsDialog?<PartsRequirementDialog controller={c} accepting={task.stage==='待接单'} onUploading={photoBlocked} onClose={()=>setPartsDialog(false)}/>:null}
    {dialog?<FormDialog open className="technician-completion-dialog" title={dialog==='submit-order'?'确认维修完成？':dialog==='pause'?'暂停维修':'无法接单'} okText={dialog==='submit-order'?'确认提交':'确认'} onOk={()=>void confirm()} confirmLoading={c.busy} okButtonProps={{disabled:dialog==='submit-order'&&(!hasRepairPhoto||blocked||!itemsEditor.valid||itemsEditor.stale)}} onCancel={()=>{if(!c.busy){setDialog(undefined);itemsEditor.cancel();}}} cancelButtonProps={{disabled:c.busy}} closable={!c.busy} mask={{closable:false}}>
      {dialog==='submit-order'?<p>提交前须上传至少一张本轮维修照片，完工说明选填。提交后由检验员检查。</p>:<Select aria-label="问题原因" style={{width:'100%',marginBottom:16}} value={reason} onChange={setReason} options={(dialog==='pause'?['待配件','待客户确认','技术问题','其他']:['时间冲突','无法维修此项目','其他']).map(value=>({value,label:value}))}/>}
      {dialog==='submit-order'?<section><h3>主要作业与增修项目</h3><RepairItemsEditor items={task.items} rows={itemsEditor.rows} onChange={itemsEditor.setRows} editing disabled={c.busy} rejectedItemIds={task.rejectedItemIds}/>{itemsEditor.stale?<Alert type="warning" title="工单已更新，请重新载入项目后编辑" action={<Button onClick={itemsEditor.begin}>重新载入</Button>}/>:null}</section>:null}
      {dialog==='submit-order'&&!hasRepairPhoto?<Alert type="warning" showIcon title="请先返回并上传本轮维修照片"/>:null}
      {dialog==='submit-order'||reason==='其他'?<label className="repair-completion-note"><span>{dialog==='submit-order'?'完工说明（选填）':'问题说明'}</span><Input.TextArea aria-label={dialog==='submit-order'?'完工说明（选填）':'问题说明'} placeholder={dialog==='submit-order'?'填写维修结果或注意事项':'请说明原因'} rows={3} maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></label>:null}
      {c.error?<Alert type="error" title={c.error}/>:null}
    </FormDialog>:null}
  </div>;
}
