import { RepairStatusTag } from './RepairStatusTag';
import { useCallback, useState } from 'react';
import { Alert, Button, Collapse, Input, Select, Tag } from 'antd';
import type { UserProfile } from '../../../../shared/types';
import type { DispatchController } from './useDispatchController';
import { FormDialog } from '../../shared/ui/BusinessForm';
import { RepairPhotoPanel } from './RepairPhotoPanel';
import { displayTime,taskStatusLabel } from './dispatchLabels';
export function TechnicianTaskDetail({controller:c,user,onPhotoBlocked}:{controller:DispatchController;user:UserProfile;onPhotoBlocked:(blocked:boolean)=>void}) {
  const [dialog,setDialog]=useState<'submit-order'|'pause'|'decline'>();
  const [note,setNote]=useState(''),[reason,setReason]=useState('待配件'),[blocked,setBlocked]=useState(false);
  const photoBlocked=useCallback((value:boolean)=>{setBlocked(value);onPhotoBlocked(value);},[onPhotoBlocked]);
  const task=c.detail!.task;
  const editable=!task.needsReview && (task.technicianIds??[task.technicianId]).includes(user.id);
  const canPhoto=editable&&['待开工','维修中','暂停'].includes(task.stage);
  const pending=task.items.some(i=>['待开工','待派工','待领料'].includes(i.status));
  const primary=task.stage==='待接单'&&!task.feedback?'accept':task.stage==='暂停'?'resume':['待开工','维修中'].includes(task.stage)?pending?'start-order':'submit-order':undefined;
  const label=primary==='accept'?'确认接单':primary==='resume'?'继续维修':primary==='start-order'?task.rework?'开始返工':'开始维修':'提交完工';
  async function confirm() {
    if(dialog==='submit-order') {if(await c.act({action:dialog,note}))setDialog(undefined);}
    if(dialog==='pause') {if(await c.act({action:dialog,pauseReason:reason,note}))setDialog(undefined);}
    if(dialog==='decline') {if(await c.act({action:dialog,reason:reason==='其他'?note:reason}))setDialog(undefined);}
  }
  return <div className="technician-detail">
    <RepairStatusTag status={taskStatusLabel(task)}/>
    <p className="dispatch-muted">预计完工：{displayTime(task.dueAt)}</p>
    {c.error?<Alert type="error" showIcon title={c.error}/>:null}
    {task.needsReview?<Alert type="warning" title="请联系服务顾问核对任务后再维修"/>:null}
    {task.feedback?<Alert type="warning" title="已反馈无法接单，等待服务顾问处理" description={task.feedback}/>:null}
    {task.stage==='暂停'?<Alert type="warning" title={`暂停：${task.pauseReason}`} description={task.pauseNote}/>:null}
    {task.rework?<Alert type="warning" title="需要返工" description={task.reworkReason||'请查看退回维修项目'}/>:null}
    {task.stage==='待检验'?<Alert type="info" title={task.inspectorName?`${task.inspectorName}已接手检验`:'已提交，等待检验员领取'}/>:null}
    <section><h3>维修内容</h3><ul className="technician-items">{task.items.map(item=><li key={item.id}><span>{item.name}</span>{task.rejectedItemIds?.includes(item.id)&&item.status!=='已完工'?<Tag color="orange">退回维修</Tag>:<RepairStatusTag status={item.status}/>}</li>)}</ul></section>
    {task.faultDescription?<section><h3>故障描述</h3><p>{task.faultDescription}</p></section>:null}
    {task.note?<section><h3>派工备注</h3><p>{task.note}</p></section>:null}
    <RepairPhotoPanel controller={c} editable={canPhoto} onBlocked={photoBlocked}/>
    <Collapse items={[{key:'more',label:'更多信息',children:<><p>委托单：{task.orderId}</p><p>接单：{displayTime(task.acceptedAt)}</p><p>开工：{displayTime(task.firstStartedAt)}</p>{c.detail!.events.map(e=><p key={e.id}>{displayTime(e.at)} · {e.actorName} · {e.detail.stage}{e.detail.reason?` · ${e.detail.reason}`:''}</p>)}</>}]} />
    {primary&&editable&&!task.needsReview?<div className="technician-action-bar"><div className="technician-action-buttons">
      {['待接单','待开工','维修中'].includes(task.stage)?<Button className={task.stage==='待接单'?'repair-decline-button':'repair-pause-button'} danger={task.stage==='待接单'} color={task.stage==='待接单'?'danger':'orange'} variant="outlined" onClick={()=>{setNote('');setReason(task.stage==='待接单'?'时间冲突':'待配件');setDialog(task.stage==='待接单'?'decline':'pause');}} disabled={c.busy||blocked||Boolean(task.feedback)}>{task.stage==='待接单'?'无法接单':'暂停维修'}</Button>:null}
      <Button type="primary" block loading={c.busy} disabled={c.busy||blocked} onClick={()=>{if(primary==='submit-order'){setNote('');setDialog(primary);}else void c.act({action:primary});}}>{label}</Button></div>{blocked?<span>请等待照片上传完成，或处理失败照片</span>:null}</div>:null}
    {dialog?<FormDialog open title={dialog==='submit-order'?'确认维修完成？':dialog==='pause'?'暂停维修':'无法接单'} okText={dialog==='submit-order'?'确认提交':'确认'} onOk={()=>void confirm()} confirmLoading={c.busy} onCancel={()=>{if(!c.busy)setDialog(undefined);}} cancelButtonProps={{disabled:c.busy}} closable={!c.busy} mask={{closable:false}}>
      {dialog==='submit-order'?<p>提交后由检验员检查。维修照片和完工说明均为选填。</p>:<Select aria-label="问题原因" style={{width:'100%',marginBottom:16}} value={reason} onChange={setReason} options={(dialog==='pause'?['待配件','待客户确认','技术问题','其他']:['时间冲突','无法维修此项目','其他']).map(value=>({value,label:value}))}/>}
      {dialog==='submit-order'||reason==='其他'?<Input.TextArea aria-label={dialog==='submit-order'?'完工说明（选填）':'问题说明'} placeholder={dialog==='submit-order'?'完工说明（选填）':'请说明原因'} rows={3} maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/>:null}
      {c.error?<Alert type="error" title={c.error}/>:null}
    </FormDialog>:null}
  </div>;
}
