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
export function PendingRepairsPanel({orderId,user,onChanged,stage}:{orderId:string;user?:UserProfile;onChanged?:()=>void;stage?:string}) {
 const c=usePendingRepairs(orderId,onChanged);
 const editable=!!user&&hasAnyRole(user,['manager','advisor']);
 const [dialog,setDialog]=useState<{action:PendingRepairCommand['action'];item?:PendingRepair}>();
 const [execution,setExecution]=useState<DispatchExecution>({executionMode:'internal'});
 const [name,setName]=useState(''),[reason,setReason]=useState(''),[note,setNote]=useState(''),[technicianId,setTechnician]=useState<string>(),[dueAt,setDue]=useState('');
 function open(action:PendingRepairCommand['action'],item?:PendingRepair){setName('');setReason('');setNote('');setTechnician(undefined);setDue('');setDialog({action,item});if(['schedule','approve-and-schedule'].includes(action))void c.loadPeople().then(result=>{if(result){const {task,defaultTechnicianId}=result;setTechnician(defaultTechnicianId);const {executionMode,contractorId,contractor,outsourcingMode,serviceUnit,serviceAddress,serviceContact}=task;setExecution({executionMode,contractorId,contractor,outsourcingMode,serviceUnit,serviceAddress,serviceContact});}});}
 async function submit(){if(!dialog)return;const ok=await c.act({action:dialog.action,id:dialog.item?.id,name,reason,note,...execution,technicianId,dueAt:dueAt?new Date(`${dueAt}:00+08:00`).toISOString():undefined});if(ok)setDialog(undefined);}
 const schedulingBlock=pendingRepairScheduleBlock(stage??c.task?.stage);
 const scheduling=!!dialog&&['schedule','approve-and-schedule'].includes(dialog.action);
 return <section className="pending-repairs-panel" aria-label="待客户确认项目">
  <header className="pending-repairs-header">
   <div><h3>待客户确认项目</h3><span className="pending-repairs-count">{c.data.items.filter(i=>i.state==='pending').length} 项待回复</span></div>
   {editable&&<Button className="pending-repairs-add" icon={<PlusOutlined/>} aria-label="登记待确认项目" disabled={!c.loaded||c.busy} onClick={()=>open('add')}>登记项目</Button>}
  </header>
  {editable&&schedulingBlock&&c.data.items.some(item=>!item.scheduled&&item.state!=='declined')&&<Alert type="info" showIcon title={schedulingBlock}/>}
  {c.error&&<Alert type="error" showIcon title={c.error}/>}
  <div className="pending-repairs-list">{c.data.items.map((item,index)=><article key={item.id} className={`pending-repair-card is-${item.state}`}>
   <div className="pending-repair-heading"><div className="pending-repair-name"><span className="pending-repair-number">{String(index+1).padStart(2,'0')}</span><strong>{item.name}</strong></div><Tag color={item.state==='pending'?'orange':item.state==='approved'?'green':'default'}>{item.scheduled?'已安排维修':labels[item.state]}</Tag></div>
   <div className="pending-repair-reason"><span>待确认原因</span><p>{item.reason}</p></div>
   {editable&&(item.state==='pending'||item.state==='approved'&&!item.scheduled)&&<div className="pending-repair-actions">
    <Button type="primary" disabled={c.busy||Boolean(schedulingBlock)} onClick={()=>open(item.state==='pending'?'approve-and-schedule':'schedule',item)}>安排维修</Button>
    {item.state==='pending'&&<Button disabled={c.busy} onClick={()=>open('decline',item)}>本次暂不维修</Button>}
   </div>}
   <Collapse className="pending-repair-history" ghost items={[{key:'history',label:'处理记录',children:<ol className="pending-repair-history-list">{item.history.map((h,i)=><li key={i}><div><strong>{h.action}</strong><span>{h.actor}{h.respondent?` · 回复人：${h.respondent}`:''}</span></div><time>{displayTime(h.at)}</time>{h.note&&<p>{h.note}</p>}</li>)}</ol>}]}/>
  </article>)}</div>
  {!c.data.items.length&&c.loaded&&<p className="pending-repairs-empty">暂无待确认项目</p>}
  {c.data.items.length>0&&<details className="pending-repairs-sync"><summary><InfoCircleOutlined/> 润丰同步说明</summary><p>润丰项目通过后续检验写回更新；没有后续写回或润丰单据已锁定时，需人工在润丰处理。</p></details>}
  {dialog&&<FormDialog open title={dialog.action==='add'?'登记待确认项目':scheduling?'安排维修':'登记客户回复'} onCancel={()=>{if(!c.busy)setDialog(undefined);}} onOk={()=>void submit()} confirmLoading={c.busy} okText={scheduling?'安排维修':dialog.action==='decline'?'本次暂不维修':'确定'} okButtonProps={{disabled:scheduling&&(!c.task||Boolean(schedulingBlock))}}>
   <Form layout="vertical">
    {scheduling&&schedulingBlock&&<Alert type="info" showIcon title={schedulingBlock}/>}
    {dialog.action==='add'?<><Form.Item label="项目名称" required><Input aria-label="待确认项目名称" value={name} maxLength={200} onChange={e=>setName(e.target.value)}/></Form.Item><Form.Item label="待确认原因" required><Input.TextArea aria-label="待确认原因" value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)}/></Form.Item></>:scheduling?<><Alert type="info" title="当前维修尚未提检时加入本轮；本轮已完成时新增追加维修轮次。待检验时请先完成当前检验。"/>{c.task?.stage==='待派工'&&<p>加入正式维修清单后，请在派工安排中统一分配维修工和预计完工时间。</p>}{c.task?.stage==='维修完成'&&<DispatchExecutionFields value={execution} onChange={setExecution} hideFee allowModeChange={c.task?.stage==='维修完成'} contractors={c.people?.contractors}/>}{c.task?.stage!=='待派工'&&execution.executionMode!=='outsourced'&&<Form.Item label="维修工" required><Select aria-label="追加维修工" style={{width:'100%'}} value={technicianId} onChange={setTechnician} options={c.people?.technicians.map(p=>({value:p.id,label:p.name}))}/></Form.Item>}{c.task?.stage==='维修完成'&&<Form.Item label="预计完工时间" required><Input aria-label="追加维修预计完工时间" style={{minWidth:0,width:'100%'}} type="datetime-local" value={dueAt} onChange={e=>setDue(e.target.value)}/></Form.Item>}</>:<></>}
    {dialog.action!=='add'&&<Form.Item label="备注（选填）"><Input.TextArea aria-label="备注（选填）" value={note} maxLength={2000} onChange={e=>setNote(e.target.value)}/></Form.Item>}
    {c.error&&<Alert type="error" title={c.error}/>}
   </Form>
  </FormDialog>}
 </section>;
}
