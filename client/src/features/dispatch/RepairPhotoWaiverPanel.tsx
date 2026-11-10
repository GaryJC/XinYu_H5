import {useState} from 'react';
import {Alert,Button,Input,Space,Tag} from 'antd';
import type {RepairPhotoWaiver,UserProfile} from '../../../../shared/types';
import {hasAnyRole} from '../../../../shared/roles.mjs';
import {canRequestPhotoWaiver,currentPhotoWaiver,pendingPhotoWaivers} from '../../../../shared/repairPhotoWaiver.mjs';
import {FormDialog} from '../../shared/ui/BusinessForm';
import type {DispatchController} from './useDispatchController';
import {displayTime} from './dispatchLabels';
import './repair-photo-waiver.css';

const labels={pending:'待审批',approved:'已通过',rejected:'已驳回'};
export function PhotoWaiverRecord({entry}:{entry:RepairPhotoWaiver}) {
 return <div className="photo-waiver-record"><p><strong>{entry.applicantName}</strong> · {labels[entry.status]} · {displayTime(entry.requestedAt)}</p>
  <p>{entry.reason}</p>{entry.decidedBy&&<p>{entry.decidedName} · {displayTime(entry.decidedAt)}{entry.decisionReason?` · ${entry.decisionReason}`:''}</p>}</div>;
}
export function RepairPhotoWaiverPanel({controller:c,user,blocked=false}:{controller:DispatchController;user:UserProfile;blocked?:boolean}) {
 const task=c.detail!.task;
 const [dialog,setDialog]=useState<{action:'request-photo-waiver'|'approve-photo-waiver'|'reject-photo-waiver';entry?:RepairPhotoWaiver}>();
 const [reason,setReason]=useState('');
 const mine=currentPhotoWaiver(task,user.id);
 const approver=hasAnyRole(user,['manager','advisor']);
 const entries=(task.repairPhotoWaivers||[]).filter(entry=>currentPhotoWaiver(task,entry.applicantId)===entry&&(approver||entry.applicantId===user.id));
 const pending=pendingPhotoWaivers(task);
 const canApply=canRequestPhotoWaiver(task,user)&&(!mine||mine.status==='rejected');
 const busy=c.busy||blocked;
 if(!entries.length&&!canApply)return null;
 const title=dialog?.action==='request-photo-waiver'?'申请无维修照片审批':dialog?.action==='approve-photo-waiver'?'通过无维修照片审批？':'驳回无维修照片申请';
 const needsReason=dialog?.action!=='approve-photo-waiver';
 async function confirm() {
  if(!dialog||busy||needsReason&&!reason.trim())return;
  if(await c.act({action:dialog.action,...(dialog.entry?{waiverId:dialog.entry.id}:{}),...(needsReason?{reason:reason.trim()}:{})}))setDialog(undefined);
 }
 return <div className="photo-waiver-panel" aria-label="无维修照片审批">
  <div className="photo-waiver-heading"><strong>无维修照片审批</strong>{canApply&&<Button disabled={busy} onClick={()=>{setReason('');setDialog({action:'request-photo-waiver'});}}>{mine?'重新申请':'申请审批'}</Button>}</div>
  {entries.map(entry=><div className="photo-waiver-entry" key={entry.id}><Tag color={entry.status==='approved'?'green':entry.status==='rejected'?'red':'orange'}>{entry.applicantName} · {labels[entry.status]}</Tag>
   <p>{entry.reason}</p>{entry.decidedBy?<p>{entry.decidedName} · {displayTime(entry.decidedAt)}{entry.decisionReason?` · ${entry.decisionReason}`:''}</p>:<p className="dispatch-muted">等待本店管理员或服务顾问审批</p>}
   {entry.status==='approved'&&entry.applicantId===user.id&&<p>本次维修可免传维修照片，其他完工条件仍需满足。</p>}
   {approver&&entry.applicantId!==user.id&&pending.some(row=>row.id===entry.id)&&<Space wrap><Button type="primary" disabled={busy} onClick={()=>{setReason('');setDialog({action:'approve-photo-waiver',entry});}}>通过</Button><Button danger disabled={busy} onClick={()=>{setReason('');setDialog({action:'reject-photo-waiver',entry});}}>驳回</Button></Space>}
  </div>)}
  {dialog&&<FormDialog open title={title} okText={dialog.action==='approve-photo-waiver'?'确认通过':'提交'} onOk={()=>void confirm()} onCancel={()=>{if(!c.busy)setDialog(undefined);}} confirmLoading={c.busy} okButtonProps={{disabled:busy||needsReason&&!reason.trim()}} cancelButtonProps={{disabled:c.busy}} closable={!c.busy} mask={{closable:false}}>
   {dialog.entry&&<PhotoWaiverRecord entry={dialog.entry}/>}
   {dialog.action==='request-photo-waiver'&&<p>手机上交、镜头遮挡或现场禁止拍照时可申请。审批仅对本人本次维修有效；改派、项目变更或返工后需重新申请。</p>}
   {needsReason?<label className="photo-waiver-reason">{dialog.action==='request-photo-waiver'?'无法拍照原因':'驳回原因'}<Input.TextArea aria-label={dialog.action==='request-photo-waiver'?'无法拍照原因':'驳回原因'} value={reason} onChange={event=>setReason(event.target.value)} disabled={c.busy} rows={4} maxLength={1000} placeholder={dialog.action==='request-photo-waiver'?'例如：现场禁止拍照，手机由门卫保管。请勿填写涉密内容。':undefined}/></label>:<p>确认允许该申请人免传本次维修照片后提交完工。</p>}
   {c.error&&<Alert type="error" showIcon title={c.error}/>}
  </FormDialog>}
 </div>;
}
