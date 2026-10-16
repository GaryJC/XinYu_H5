import { FormDialog, FormSection } from '../../shared/ui/BusinessForm';
import './dispatch.css';
import { DispatchExecutionFields } from './DispatchExecutionFields';
import { useState } from 'react';
import { Alert,Button,Checkbox,Form,Input,InputNumber,Select } from 'antd';
import type { DispatchActionName,DispatchTask,DispatchExecution } from '../../../../shared/types';
import type { ActionInput,DispatchController } from './useDispatchController';
import { actionLabels,localDateTime,personDisplayName } from './dispatchLabels';
export function DispatchActionDialog({action,task,controller,onClose}:{action:DispatchActionName;task:DispatchTask;controller:DispatchController;onClose:()=>void}) {
  const reopening=action==='reopen-repair';
  const [reworkItemIds,setReworkItemIds]=useState<number[]>([]);
  const [additionalItems,setAdditionalItems]=useState<string[]>([]);
  const [technicianIds,setTechnicianIds]=useState<string[]>(task.technicianIds??(task.technicianId?[task.technicianId]:[]));
  const [execution,setExecution]=useState<DispatchExecution>({executionMode:task.executionMode||'internal',serviceUnit:task.serviceUnit,serviceAddress:task.serviceAddress,serviceContact:task.serviceContact,departureAt:reopening?undefined:task.departureAt,expectedReturnAt:reopening?undefined:task.expectedReturnAt,returnedAt:reopening?undefined:task.returnedAt,contractor:task.contractor,outsourcingMode:task.outsourcingMode,agreedFee:reopening?undefined:task.agreedFee,handedOverAt:reopening?undefined:task.handedOverAt,receivedAt:reopening?undefined:task.receivedAt});
  const [workHours,setWorkHours]=useState<number|null>(task.workHours??null);
  const [inspectorId,setInspectorId]=useState<string>();
  const [dueAt,setDueAt]=useState(reopening?'':localDateTime(task.dueAt));
  const [urgent,setUrgent]=useState(Boolean(task.urgent));
  const [note,setNote]=useState(['assign','reassign','update','reconcile'].includes(action)?task.note||'':'');
  const [reason,setReason]=useState('');
  const [pauseReason,setPauseReason]=useState('待配件');
  const [rejectedItemIds,setRejectedItemIds]=useState<number[]>([]);
  const [error,setError]=useState('');
  const assign=['assign','reassign','reconcile','reopen-repair'].includes(action), historical=action==='reconcile'&&task.stage==='维修完成', scheduling=(assign&&!historical)||action==='update';
  async function submit() {
    setError('');
    if(reopening && !reworkItemIds.length&&!additionalItems.some(n=>n.trim())) {setError('请至少选择一个原项目或添加一个补充项目');return;}
    if(reopening && additionalItems.some(n=>!n.trim())) {setError('请填写补充项目名称，或移除空白项目');return;}
    if(assign && execution.executionMode!=='outsourced' && !technicianIds.length) {setError('请选择维修工');return;}
    if(scheduling && !dueAt) {setError('请填写预计完工时间');return;}
    if(['submit','reassign-inspection'].includes(action) && !inspectorId) {setError('请选择检验员');return;}
    if((['reopen-repair','decline','cancel','reassign','reconcile','reassign-inspection'].includes(action)||(action==='inspect' && rejectedItemIds.length)) && !reason.trim()) {setError('请填写原因或交接说明');return;}
    if(action==='record-hours' && (!workHours || workHours<=0)) {setError('请填写大于 0 的实际工时');return;}
    if(action==='record-hours' && task.workHours!==undefined && !reason.trim()) {setError('修改工时请填写原因');return;}
    const input:ActionInput={action,note};
    if(reopening) {input.reworkItemIds=reworkItemIds;input.additionalItems=additionalItems.map(n=>n.trim());}
    if(action==='record-hours') input.workHours=workHours!;
    if(assign) input.technicianIds=execution.executionMode==='outsourced'?[]:technicianIds;
    if(assign||action==='update') Object.assign(input,execution);
    if(reopening||task.repairRound) delete input.agreedFee;
    if(scheduling) {input.dueAt=new Date(`${dueAt}:00+08:00`).toISOString();input.urgent=urgent;}
    if(['submit','reassign-inspection'].includes(action)) input.inspectorId=inspectorId;
    if(reason) input.reason=reason;
    if(action==='pause') input.pauseReason=pauseReason;
    if(action==='inspect') input.rejectedItemIds=rejectedItemIds;
    if(await controller.act(input)) onClose();
  }
  return <FormDialog open title={actionLabels[action]} onCancel={()=>{if(!controller.busy) onClose();}} onOk={()=>void submit()} confirmLoading={controller.busy} okText="确认" cancelText="取消" mask={{closable:false}} closable={!controller.busy} cancelButtonProps={{disabled:controller.busy}}>
    <Form layout="vertical" className="dispatch-form" requiredMark>
      {reopening?<FormSection title="本次返工内容"><Alert type="info" showIcon title="沿用原委托单，无需重新签字" description="本次只安排维修，不变更原费用与结算。请选原项目或补充项目，并填写原因。"/>
        <Form.Item label="原维修项目"><Checkbox.Group className="reopen-project-options" value={reworkItemIds} onChange={values=>setReworkItemIds(values as number[])} options={(task.repairCatalog||task.items).map(i=>({value:i.id,label:i.name}))}/></Form.Item>
        {additionalItems.map((name,index)=><div className="reopen-extra-item" key={index}><Input aria-label={`补充项目 ${index+1}`} value={name} maxLength={200} placeholder="填写补充维修项目名称" onChange={e=>setAdditionalItems(items=>items.map((v,i)=>i===index?e.target.value:v))}/><Button aria-label={`移除补充项目 ${index+1}`} onClick={()=>setAdditionalItems(items=>items.filter((_,i)=>i!==index))}>移除</Button></div>)}
        <Button disabled={additionalItems.length>=50} onClick={()=>setAdditionalItems(items=>[...items,''])}>添加补充项目</Button>
      </FormSection>:null}
      {action==='record-hours'?<><Alert type="info" title="工时按整单记录，由服务顾问／派单人员填写；未填写不能最终完结。"/><Form.Item label="实际工时（小时）" required><InputNumber aria-label="实际工时" min={0.01} max={10000} precision={2} value={workHours} onChange={setWorkHours}/></Form.Item></>:null}
      {error||controller.error?<Alert type="error" showIcon title={error||controller.error}/>:null}
      {(assign&&!historical)||action==='update'?<FormSection title="执行方式"><DispatchExecutionFields value={execution} onChange={setExecution} allowModeChange={assign} hideFee={reopening||Boolean(task.repairRound)}/></FormSection>:null}
      {assign && <FormSection title="人员安排与说明">
      {assign&&execution.executionMode!=='outsourced'?<Form.Item label="维修员工（可多选，平级协作）" required><Select mode="multiple" aria-label="维修工" value={technicianIds} onChange={setTechnicianIds} placeholder="选择同店维修员工" options={controller.people.technicians.map(p=>({value:p.id,label:`${personDisplayName(p,controller.people.technicians)} · 当前 ${controller.summaries.find(s=>s.id===p.id)?.current||0} 单`}))}/></Form.Item>:null}
      {assign&&execution.executionMode!=='outsourced'&&!controller.people.technicians.length?<Alert type="info" title="暂无可派维修工，请配置钉钉角色并让员工登录一次。"/>:null}
      {assign?<Alert type="info" title={execution.executionMode==='outsourced'?'外包进度由服务顾问或管理员录入，完工后需独立检验。':'所选员工共同维护工单进度，任一人确认即代表工单接单；每次操作均记录实际操作人。'}/>:null}
      </FormSection>}
      <FormSection title={scheduling ? "时间与备注" : "操作说明"}>
      {scheduling?<><Form.Item label="预计完工时间" required><Input aria-label="预计完工时间" type="datetime-local" value={dueAt} onChange={e=>setDueAt(e.target.value)}/></Form.Item><Checkbox checked={urgent} onChange={e=>setUrgent(e.target.checked)}>加急任务</Checkbox></>:null}
      {['submit','reassign-inspection'].includes(action)?<Form.Item label="指定检验员" required><Select aria-label="指定检验员" placeholder="选择检验员或管理员" value={inspectorId} onChange={setInspectorId} options={controller.people.inspectors.filter(p=>!(task.technicianIds??[task.technicianId]).includes(p.id) && !task.participantIds?.includes(p.id) && !task.items.some(i=>i.startedBy===p.id||i.finishedBy===p.id)).map(p=>({value:p.id,label:personDisplayName(p,controller.people.inspectors)}))}/></Form.Item>:null}
      {action==='pause'?<Form.Item label="暂停原因"><Select aria-label="暂停原因" value={pauseReason} onChange={setPauseReason} options={['待配件','待客户确认','技术问题','其他'].map(value=>({value,label:value}))}/></Form.Item>:null}
      {action==='inspect'?<><Alert type="info" title="不选择退回项目表示全部通过；勾选的项目退回返工，其余本次项目检验通过。"/><Checkbox.Group value={rejectedItemIds} onChange={values=>setRejectedItemIds(values as number[])} options={task.items.filter(i=>i.status==='待检验').map(i=>({value:i.id,label:`退回：${i.name}`}))}/></>:null}
      {(['reopen-repair','decline','cancel','reassign','reconcile','inspect','reassign-inspection'].includes(action)||(action==='record-hours'&&task.workHours!==undefined))?<Form.Item label={reopening?"返工原因":"原因 / 交接说明"} required={reopening}><Input.TextArea aria-label="原因或交接说明" value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)} rows={3}/></Form.Item>:null}
      <Form.Item label={action==='submit'?'完工提报说明':'备注'}><Input.TextArea aria-label="备注" value={note} maxLength={2000} onChange={e=>setNote(e.target.value)} rows={3}/></Form.Item>
      {action==='reconcile'?<Alert type="warning" title={historical?"仅核对历史人员，不重新接单、不补发通知、不补造完成时间。":"确认归属后重新发起接单，保留已有项目进度，不补录历史时间。"}/>:null}
      </FormSection>
    </Form>
  </FormDialog>;
}
