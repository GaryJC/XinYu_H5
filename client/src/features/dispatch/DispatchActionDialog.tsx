import { DispatchExecutionFields } from './DispatchExecutionFields';
import { useState } from 'react';
import { Alert,Checkbox,Input,InputNumber,Modal,Select } from 'antd';
import type { DispatchActionName,DispatchTask,DispatchExecution } from '../../../../shared/types';
import type { ActionInput,DispatchController } from './useDispatchController';
import { actionLabels,localDateTime,personDisplayName } from './dispatchLabels';
export function DispatchActionDialog({action,task,controller,onClose}:{action:DispatchActionName;task:DispatchTask;controller:DispatchController;onClose:()=>void}) {
  const [technicianIds,setTechnicianIds]=useState<string[]>(task.technicianIds??(task.technicianId?[task.technicianId]:[]));
  const [execution,setExecution]=useState<DispatchExecution>({executionMode:task.executionMode||'internal',serviceUnit:task.serviceUnit,serviceAddress:task.serviceAddress,serviceContact:task.serviceContact,departureAt:task.departureAt,expectedReturnAt:task.expectedReturnAt,returnedAt:task.returnedAt,contractor:task.contractor,outsourcingMode:task.outsourcingMode,agreedFee:task.agreedFee,handedOverAt:task.handedOverAt,receivedAt:task.receivedAt});
  const [workHours,setWorkHours]=useState<number|null>(task.workHours??null);
  const [inspectorId,setInspectorId]=useState<string>();
  const [dueAt,setDueAt]=useState(localDateTime(task.dueAt));
  const [urgent,setUrgent]=useState(Boolean(task.urgent));
  const [note,setNote]=useState(['assign','reassign','update','reconcile'].includes(action)?task.note||'':'');
  const [reason,setReason]=useState('');
  const [pauseReason,setPauseReason]=useState('待配件');
  const [rejectedItemIds,setRejectedItemIds]=useState<number[]>([]);
  const [error,setError]=useState('');
  const assign=['assign','reassign','reconcile'].includes(action), historical=action==='reconcile'&&task.stage==='维修完成', scheduling=(assign&&!historical)||action==='update';
  async function submit() {
    setError('');
    if(assign && execution.executionMode!=='outsourced' && !technicianIds.length) {setError('请选择维修工');return;}
    if(scheduling && !dueAt) {setError('请填写预计完工时间');return;}
    if(action==='submit' && !inspectorId) {setError('请选择检验员');return;}
    if((['decline','cancel','reassign','reconcile'].includes(action)||(action==='inspect' && rejectedItemIds.length)) && !reason.trim()) {setError('请填写原因或交接说明');return;}
    if(action==='record-hours' && (!workHours || workHours<=0)) {setError('请填写大于 0 的实际工时');return;}
    if(action==='record-hours' && task.workHours!==undefined && !reason.trim()) {setError('修改工时请填写原因');return;}
    const input:ActionInput={action,note};
    if(action==='record-hours') input.workHours=workHours!;
    if(assign) input.technicianIds=execution.executionMode==='outsourced'?[]:technicianIds;
    if(assign||action==='update') Object.assign(input,execution);
    if(scheduling) {input.dueAt=new Date(`${dueAt}:00+08:00`).toISOString();input.urgent=urgent;}
    if(action==='submit') input.inspectorId=inspectorId;
    if(reason) input.reason=reason;
    if(action==='pause') input.pauseReason=pauseReason;
    if(action==='inspect') input.rejectedItemIds=rejectedItemIds;
    if(await controller.act(input)) onClose();
  }
  return <Modal open title={actionLabels[action]} onCancel={()=>{if(!controller.busy) onClose();}} onOk={()=>void submit()} confirmLoading={controller.busy} okText="确认" cancelText="取消" maskClosable={false}>
    <div className="dispatch-form">
      {action==='record-hours'?<><Alert type="info" title="工时按整单记录，由服务顾问／派单人员填写；未填写不能最终完结。"/><label>实际工时（小时）<InputNumber aria-label="实际工时" min={0.01} max={10000} precision={2} value={workHours} onChange={setWorkHours}/></label></>:null}
      {error||controller.error?<Alert type="error" showIcon title={error||controller.error}/>:null}
      {(assign&&!historical)||action==='update'?<DispatchExecutionFields value={execution} onChange={setExecution} allowModeChange={assign}/>:null}
      {assign&&execution.executionMode!=='outsourced'?<label>维修员工（可多选，平级协作）<Select mode="multiple" aria-label="维修工" value={technicianIds} onChange={setTechnicianIds} placeholder="选择同店维修员工" options={controller.people.technicians.map(p=>({value:p.id,label:`${personDisplayName(p,controller.people.technicians)} · 当前 ${controller.summaries.find(s=>s.id===p.id)?.current||0} 单`}))}/></label>:null}
      {assign&&execution.executionMode!=='outsourced'&&!controller.people.technicians.length?<Alert type="info" title="暂无可派维修工，请配置钉钉角色并让员工登录一次。"/>:null}
      {assign?<Alert type="info" title={execution.executionMode==='outsourced'?'外包进度由服务顾问或管理员录入，完工后需独立检验。':'所选员工共同维护工单进度，任一人确认即代表工单接单；每次操作均记录实际操作人。'}/>:null}
      {scheduling?<><label>预计完工时间（上海时间）<Input aria-label="预计完工时间" type="datetime-local" value={dueAt} onChange={e=>setDueAt(e.target.value)}/></label><Checkbox checked={urgent} onChange={e=>setUrgent(e.target.checked)}>加急任务</Checkbox></>:null}
      {action==='submit'?<label>指定检验员<Select aria-label="指定检验员" placeholder="选择检验员或管理员" value={inspectorId} onChange={setInspectorId} options={controller.people.inspectors.filter(p=>!(task.technicianIds??[task.technicianId]).includes(p.id) && !task.participantIds?.includes(p.id) && !task.items.some(i=>i.startedBy===p.id||i.finishedBy===p.id)).map(p=>({value:p.id,label:personDisplayName(p,controller.people.inspectors)}))}/></label>:null}
      {action==='pause'?<label>暂停原因<Select aria-label="暂停原因" value={pauseReason} onChange={setPauseReason} options={['待配件','待客户确认','技术问题','其他'].map(value=>({value,label:value}))}/></label>:null}
      {action==='inspect'?<><Alert type="info" title="不选择退回项目表示全部通过；勾选的项目退回返工，其余本次项目检验通过。"/><Checkbox.Group value={rejectedItemIds} onChange={values=>setRejectedItemIds(values as number[])} options={task.items.filter(i=>i.status==='待检验').map(i=>({value:i.id,label:`退回：${i.name}`}))}/></>:null}
      {(['decline','cancel','reassign','reconcile','inspect'].includes(action)||(action==='record-hours'&&task.workHours!==undefined))?<label>原因 / 交接说明<Input.TextArea aria-label="原因或交接说明" value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)} rows={3}/></label>:null}
      <label>{action==='submit'?'完工提报说明':'备注'}<Input.TextArea aria-label="备注" value={note} maxLength={2000} onChange={e=>setNote(e.target.value)} rows={3}/></label>
      {action==='reconcile'?<Alert type="warning" title={historical?"仅核对历史人员，不重新接单、不补发通知、不补造完成时间。":"确认归属后重新发起接单，保留已有项目进度，不补录历史时间。"}/>:null}
    </div>
  </Modal>;
}
