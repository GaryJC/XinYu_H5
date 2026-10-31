import { ActionHistory } from "../../shared/ui/ActionHistory";
import { LoadingState } from "../../shared/ui/LoadingState";
import {inspectionDeferredOwner} from '../../../../shared/inspectionDeferredOwnership.mjs';
import {canRegisterPendingRepair,canManagePendingRepair} from '../../../../shared/pendingRepairPermissions.mjs';
import {pendingRepairScheduleBlock} from '../../../../shared/pendingRepairScheduling.mjs';
import {PlusOutlined,InfoCircleOutlined} from '@ant-design/icons';
import {displayTime} from '../dispatch/dispatchLabels';
import './pending-repairs.css';
import {DispatchExecutionFields} from '../dispatch/DispatchExecutionFields';
import {useState} from 'react';
import {Alert,Button,Input,Select,Tag,Form,Collapse} from 'antd';
import {FormDialog} from '../../shared/ui/BusinessForm';
import {usePendingRepairs} from './usePendingRepairs';
import type {PendingRepair,PendingRepairCommand,UserProfile,DispatchExecution} from '../../../../shared/types';
import {hasAnyRole} from '../../../../shared/roles.mjs';
const labels={pending:'待客户确认',approved:'同意维修',declined:'本次暂不维修'};
export function PendingRepairsPanel({orderId,user,onChanged,stage,refreshVersion}:{orderId:string;user?:UserProfile;onChanged?:()=>void;stage?:string;refreshVersion?:number}) {
 const c=usePendingRepairs(orderId,onChanged,refreshVersion);
 const inspectionEditable=!!user&&hasAnyRole(user,['manager','inspector']);
 const editable=canManagePendingRepair(user);
 const canRegister=canRegisterPendingRepair(user);
 const [dialog,setDialog]=useState<{action:PendingRepairCommand['action'];item?:PendingRepair}>();
 const [formError,setFormError]=useState('');
 const [reminderNotice,setReminderNotice]=useState('');
 async function remind(item:PendingRepair){setReminderNotice('');if(await c.act({action:'remind-inspector',id:item.id}))setReminderNotice(`已加入通知队列，将提醒${inspectionDeferredOwner(item).name}处理此工单。`);}
 const [execution,setExecution]=useState<DispatchExecution>({executionMode:'internal'});
 const [name,setName]=useState(''),[reason,setReason]=useState(''),[note,setNote]=useState(''),[technicianId,setTechnician]=useState<string>(),[dueAt,setDue]=useState('');
 function open(action:PendingRepairCommand['action'],item?:PendingRepair){setFormError('');setName('');setReason('');setNote('');setTechnician(undefined);setDue('');setDialog({action,item});if(['schedule','approve-and-schedule'].includes(action))void c.loadPeople().then(result=>{if(result){const {task,defaultTechnicianId}=result;setTechnician(defaultTechnicianId);const {executionMode,contractorId,contractor,outsourcingMode,serviceUnit,serviceAddress,serviceContact}=task;setExecution({executionMode,contractorId,contractor,outsourcingMode,serviceUnit,serviceAddress,serviceContact});}});}
 async function submit(){
  if(!dialog||c.busy)return;
  setFormError('');
  if(dialog.action==='add'&&(!name.trim()||!reason.trim())){setFormError(!name.trim()?'请填写项目名称':'请填写待确认原因');return;}
  if(dialog.item?.source==='inspection'&&['decline','cancel'].includes(dialog.action)&&!note.trim()){setFormError('请填写不再维修原因');return;}
  try {
   const ok=await c.act({action:dialog.action,id:dialog.item?.id,name:name.trim(),reason:reason.trim(),note,...execution,technicianId,dueAt:dueAt?new Date(`${dueAt}:00+08:00`).toISOString():undefined});
   if(ok)setDialog(undefined);
  } catch(error){setFormError(error instanceof Error?error.message:'保存失败，请重试');}
 }

 const schedulingBlock=pendingRepairScheduleBlock(stage??c.task?.stage);
 const scheduling=!!dialog&&['schedule','approve-and-schedule'].includes(dialog.action);
 return <section className="pending-repairs-panel" aria-label="待客户确认项目">
  <header className="pending-repairs-header">
   <div><h3>待定及待客户确认项目</h3><span className="pending-repairs-count">{c.data.items.filter(i=>i.source!=='inspection'&&i.state==='pending').length} 项待客户回复{c.data.items.some(i=>i.source==='inspection'&&['pending','scheduled'].includes(i.inspectionState||''))?` · 检验待定 ${c.data.items.filter(i=>i.source==='inspection'&&['pending','scheduled'].includes(i.inspectionState||'')).length} 项`:''}</span></div>
   {canRegister&&<Button className="pending-repairs-add" icon={<PlusOutlined/>} aria-label="登记待确认项目" disabled={!c.loaded||c.busy} onClick={()=>open('add')}>登记项目</Button>}
  </header>
  {editable&&schedulingBlock&&c.data.items.some(item=>!item.scheduled&&item.state!=='declined')&&<Alert type="info" showIcon title={schedulingBlock}/>}
  {c.error&&<Alert type="error" showIcon title={c.error}/>}{reminderNotice&&<Alert type="success" showIcon title={reminderNotice}/>}
  {!c.loaded&&!c.error&&<LoadingState label="正在加载待确认项目…" />}
  <div className="pending-repairs-list">{c.data.items.map((item,index)=>{const owner=inspectionDeferredOwner(item);return <article key={item.id} className={`pending-repair-card is-${item.state}`}>
   <div className="pending-repair-heading"><div className="pending-repair-name"><span className="pending-repair-number">{String(index+1).padStart(2,'0')}</span><strong>{item.name}</strong></div><Tag color={item.scheduled?(item.progress==='检验通过'?'green':item.progress==='暂停'||item.progress==='进度待核对'?'orange':'blue'):item.state==='pending'?'orange':item.state==='approved'?'green':'default'}>{item.scheduled?(item.progress||'进度待核对'):item.source==='inspection'?(item.inspectionState==='cancelled'?'不再维修':'检验待定'):labels[item.state]}</Tag></div>
   <div className="pending-repair-reason"><span>{item.source==='inspection'?'待定原因':'待确认原因'}</span><p>{item.reason}</p></div>
   {item.source==='inspection'&&inspectionEditable&&['pending','scheduled'].includes(item.inspectionState||'')&&(owner.id===user?.id?<div className="pending-repair-actions">{item.inspectionState==='pending'?<><Button type="primary" disabled={c.busy||Boolean(schedulingBlock)} onClick={()=>open('schedule',item)}>派工维修</Button><Button danger disabled={c.busy} onClick={()=>open('decline',item)}>删除／不再维修</Button></>:<Button danger disabled={c.busy} onClick={()=>open('cancel',item)}>撤销维修</Button>}</div>:<Alert type="info" showIcon title={owner.id?`此项目须由原检验人${owner.name}处理`: '此项目缺少原检验人记录，请联系管理员核对'} description={owner.id?<Button disabled={c.busy||!c.loaded} onClick={()=>void remind(item)}>提醒原检验人处理</Button>:undefined}/>)}
   {item.source!=='inspection'&&editable&&(item.state==='pending'||item.state==='approved'&&!item.scheduled)&&<div className="pending-repair-actions">
    <Button type="primary" disabled={c.busy||Boolean(schedulingBlock)} onClick={()=>open(item.state==='pending'?'approve-and-schedule':'schedule',item)}>安排维修</Button>
    {item.state==='pending'&&<Button disabled={c.busy} onClick={()=>open('decline',item)}>本次暂不维修</Button>}
   </div>}
   <Collapse className="pending-repair-history" ghost items={[{key:'history',label:'处理记录',children:<ActionHistory items={item.history.map((h,i)=>({key:i,title:h.action,actor:h.actor,time:displayTime(h.at),detail:<>{h.respondent?<p>回复人：{h.respondent}</p>:null}{h.note?<p>{h.note}</p>:null}</>}))}/>}]}/>
  </article>;})}</div>
  {!c.data.items.length&&c.loaded&&<p className="pending-repairs-empty">暂无待确认项目</p>}
  {c.data.items.length>0&&<details className="pending-repairs-sync"><summary><InfoCircleOutlined/> 润丰同步说明</summary><p>检验待定项目须由原检验人直接派工，其他有权限人员可发送处理提醒；本轮结束后回写【待定】前缀，再次通过后移除前缀。删除或撤销另行同步，历史记录保留。首次开单带入客户待确认项目；开单后新增项目在后续一轮全部检验通过后随完整清单写回。检验通过不代表同步成功，请查看润丰写回结果。润丰已审核、结算，或项目已有非零金额、工时等计价数据时停止覆盖，需人工处理。</p></details>}
  {dialog&&<FormDialog open title={dialog.action==='add'?'登记待确认项目':scheduling?'安排维修':dialog.item?.source==='inspection'?'不再维修':'登记客户回复'} onCancel={()=>{if(!c.busy)setDialog(undefined);}} onOk={()=>void submit()} confirmLoading={c.busy||c.peopleLoading} okText={scheduling?'安排维修':dialog.action==='cancel'?'确认撤销维修':dialog.action==='decline'?(dialog.item?.source==='inspection'?'确认不再维修':'本次暂不维修'):'确定'} okButtonProps={{disabled:scheduling&&(!c.task||Boolean(schedulingBlock))}}>
   <Form layout="vertical">
    {c.peopleLoading&&<LoadingState label="正在加载派工人员…" />}
    {scheduling&&schedulingBlock&&<Alert type="info" showIcon title={schedulingBlock}/>}
    {dialog.action==='add'?<><Form.Item label="项目名称" required><Input aria-label="待确认项目名称" value={name} maxLength={200} onChange={e=>setName(e.target.value)}/></Form.Item><Form.Item label="待确认原因" required><Input.TextArea aria-label="待确认原因" value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)}/></Form.Item></>:scheduling?<><Alert type="info" title="当前维修尚未提检时加入本轮；本轮已完成时新增追加维修轮次。待检验时请先完成当前检验。"/>{c.task?.stage==='待派工'&&<p>加入正式维修清单后，请在派工安排中统一分配维修工和预计完工时间。</p>}{c.task?.stage==='维修完成'&&<DispatchExecutionFields value={execution} onChange={setExecution} hideFee allowModeChange={c.task?.stage==='维修完成'}/>}{c.task?.stage!=='待派工'&&execution.executionMode!=='outsourced'&&<Form.Item label="维修工" required><Select aria-label="追加维修工" style={{width:'100%'}} value={technicianId} onChange={setTechnician} options={c.people?.technicians.map(p=>({value:p.id,label:p.name}))}/></Form.Item>}{(c.task?.stage==='维修完成'||dialog.item?.source==='inspection')&&<Form.Item label="预计完工时间" required><Input aria-label="追加维修预计完工时间" style={{minWidth:0,width:'100%'}} type="datetime-local" value={dueAt} onChange={e=>setDue(e.target.value)}/></Form.Item>}</>:<></>}
    {dialog.action!=='add'&&<Form.Item label={dialog.item?.source==='inspection'&&!scheduling?'不再维修原因（必填）':'备注（选填）'} required={dialog.item?.source==='inspection'&&!scheduling}><Input.TextArea aria-label={dialog.item?.source==='inspection'&&!scheduling?'不再维修原因':'备注（选填）'} value={note} maxLength={2000} onChange={e=>setNote(e.target.value)}/></Form.Item>}
    {formError&&<Alert type="error" title={formError}/>}
    {c.error&&<Alert type="error" title={c.error}/>}
   </Form>
  </FormDialog>}
 </section>;
}
