import {InspectionItems} from './InspectionItems';
import {RepairItemsEditor} from './RepairItemsEditor';
import {useDispatchProjectDraft} from './useDispatchProjectDraft';
import {ProjectReassignmentFields} from './ProjectReassignmentFields';
import {useProjectReassignment} from './useProjectReassignment';
import {summarizeInspection,type InspectionReview} from './inspectionReview';
import { FormDialog, FormSection } from '../../shared/ui/BusinessForm';
import './dispatch.css';
import { DispatchExecutionFields } from './DispatchExecutionFields';
import { useState } from 'react';
import { Alert,Button,Checkbox,Form,Input,InputNumber,Radio,Select } from 'antd';
import type { DispatchActionName,DispatchTask,DispatchExecution } from '../../../../shared/types';
import type { ActionInput,DispatchController } from './useDispatchController';
import { actionLabels,localDateTime,personDisplayName } from './dispatchLabels';
export function DispatchActionDialog({action,task,controller,onClose,inspectionReview}:{action:DispatchActionName;task:DispatchTask;controller:DispatchController;onClose:()=>void;inspectionReview?:InspectionReview}) {
  const reopening=action==='reopen-repair';
  const [projectMode,setProjectMode]=useState(false);
  const partialReassignment=action==='reassign'&&projectMode;
  const projectDraft=useDispatchProjectDraft(task);
  const reassignment=useProjectReassignment(task);
  const [reworkItemIds,setReworkItemIds]=useState<number[]>([]);
  const [additionalItems,setAdditionalItems]=useState<string[]>([]);
  const [technicianIds,setTechnicianIds]=useState<string[]>(task.technicianIds??(task.technicianId?[task.technicianId]:[]));
  const [execution,setExecution]=useState<DispatchExecution>({executionMode:task.executionMode||'internal',serviceUnit:task.serviceUnit,serviceAddress:task.serviceAddress,serviceContact:task.serviceContact,departureAt:reopening?undefined:task.departureAt,expectedReturnAt:reopening?undefined:task.expectedReturnAt,returnedAt:reopening?undefined:task.returnedAt,contractor:task.contractor,contractorId:task.contractorId,outsourcingMode:task.outsourcingMode,agreedFee:reopening?undefined:task.agreedFee,handedOverAt:reopening?undefined:task.handedOverAt,receivedAt:reopening?undefined:task.receivedAt});
  const [workHours,setWorkHours]=useState<number|null>(action==='inspect'?null:task.workHours??null);
  const [inspectorId,setInspectorId]=useState<string>();
  const [dueAt,setDueAt]=useState(reopening?'':localDateTime(task.dueAt));
  const [urgent,setUrgent]=useState(Boolean(task.urgent));
  const [note,setNote]=useState(['assign','reassign','update','reconcile'].includes(action)?task.note||'':'');
  const [reason,setReason]=useState('');
  const [pauseReason,setPauseReason]=useState('待配件');
  const inspection=summarizeInspection(task.items,inspectionReview?.choices||{});
  const rejectedItemIds=inspection.rejectedItemIds;
  const inspectionStale=action==='inspect'&&inspectionReview?.version!==task.version;
  const [error,setError]=useState('');
  const assign=['assign','reassign','reconcile','reopen-repair'].includes(action)&&!partialReassignment, historical=action==='reconcile'&&task.stage==='维修完成', scheduling=(assign&&!historical)||action==='update';
  const assignmentRows=projectDraft.rows.map(row=>({...row,responsibleId:row.responsibleId??(technicianIds.length===1?technicianIds[0]:undefined)}));
  async function submit() {
    setError('');
    if(partialReassignment&&(!reassignment.valid||reassignment.stale)){setError('请选择改派项目并指定新维修工；任务更新后请重新打开窗口');return;}
    if(action==='assign'&&(projectDraft.stale||!assignmentRows.length||assignmentRows.some(row=>!row.name.trim()||execution.executionMode!=='outsourced'&&!row.responsibleId))){setError('请填写维修项目名称并逐项选择负责人；任务更新后请重新打开窗口');return;}
    if(action==='inspect'&&(inspectionStale||!inspection.complete)){setError('检验任务已更新或结果未选全，请返回详情重新确认');return;}
    if(action==='inspect'&&rejectedItemIds.length&&!note.trim()){setError('请在备注中填写退回原因');return;}
    if(reopening && !reworkItemIds.length&&!additionalItems.some(n=>n.trim())) {setError('请至少选择一个原项目或添加一个补充项目');return;}
    if(reopening && additionalItems.some(n=>!n.trim())) {setError('请填写补充项目名称，或移除空白项目');return;}
    if(assign && execution.executionMode!=='outsourced' && !technicianIds.length) {setError('请选择维修工');return;}
    if(scheduling && !dueAt) {setError('请填写预计完工时间');return;}
    if(['submit','reassign-inspection'].includes(action) && !inspectorId) {setError('请选择检验员');return;}
    if((['reopen-repair','decline','cancel','reassign','reconcile','reassign-inspection'].includes(action)) && !reason.trim()) {setError('请填写原因或交接说明');return;}
    if((action==='record-hours') && (!workHours || workHours<=0)) {setError('请填写大于 0 的实际工时');return;}
    if(action==='record-hours' && task.workHours!==undefined && !reason.trim()) {setError('修改工时请填写原因');return;}
    const input:ActionInput={action,note};
    if(partialReassignment){input.reassignItemIds=reassignment.selected;input.repairItems=reassignment.rows;}
    if(action==='assign')input.repairItems=assignmentRows.map(row=>execution.executionMode==='outsourced'?{id:row.id,name:row.name}:row);
    if(reopening) {input.reworkItemIds=reworkItemIds;input.additionalItems=additionalItems.map(n=>n.trim());}
    if(action==='record-hours') input.workHours=workHours!;
    if(assign) input.technicianIds=execution.executionMode==='outsourced'?[]:technicianIds;
    if(assign||action==='update') Object.assign(input,execution);
    if(reopening||task.repairRound) delete input.agreedFee;
    if(scheduling) {input.dueAt=new Date(`${dueAt}:00+08:00`).toISOString();input.urgent=urgent;}
    if(['submit','reassign-inspection'].includes(action)) input.inspectorId=inspectorId;
    if(reason) input.reason=reason;
    if(action==='pause') input.pauseReason=pauseReason;
    if(action==='inspect'){input.rejectedItemIds=rejectedItemIds;if(rejectedItemIds.length)input.reason=note.trim();}
    if(await controller.act(input)) onClose();
  }
  return <FormDialog open title={actionLabels[action]} onCancel={()=>{if(!controller.busy) onClose();}} onOk={()=>void submit()} confirmLoading={controller.busy} okButtonProps={{disabled:action==='inspect'&&(inspectionStale||!inspection.complete)}} okText={action==='inspect'?'确认提交检验结果':'确认'} cancelText="取消" mask={{closable:false}} closable={!controller.busy} cancelButtonProps={{disabled:controller.busy}}>
    <Form layout="vertical" className="dispatch-form" requiredMark>
      {action==='reassign'?<Form.Item label="改派范围"><Radio.Group aria-label="改派范围" value={projectMode?'items':'order'} onChange={e=>setProjectMode(e.target.value==='items')} options={[{value:'items',label:'选项目改派',disabled:task.executionMode==='outsourced'},{value:'order',label:'整单改派 / 调整执行方式'}]}/></Form.Item>:null}
      {partialReassignment?<ProjectReassignmentFields task={task} people={controller.people.technicians} draft={reassignment} disabled={controller.busy}/>:null}
      {action==='inspect'?<div className="inspection-review-section"><h3>检验结果复核</h3><InspectionItems items={task.items} choices={inspectionReview?.choices||{}} readOnly/>{inspectionStale?<Alert type="warning" title="工单已更新，请返回详情重新确认检验结果"/>:null}</div>:null}
      {reopening?<FormSection title="本次返工内容"><Alert type="info" showIcon title="沿用原委托单，无需重新签字" description="本次只安排维修，不变更原费用与结算。请选原项目或补充项目，并填写原因。"/>
        <Form.Item label="原维修项目"><Checkbox.Group className="reopen-project-options" value={reworkItemIds} onChange={values=>setReworkItemIds(values as number[])} options={(task.repairCatalog||task.items).map(i=>({value:i.id,label:i.name}))}/></Form.Item>
        {additionalItems.map((name,index)=><div className="reopen-extra-item" key={index}><Input aria-label={`补充项目 ${index+1}`} value={name} maxLength={200} placeholder="填写补充维修项目名称" onChange={e=>setAdditionalItems(items=>items.map((v,i)=>i===index?e.target.value:v))}/><Button aria-label={`移除补充项目 ${index+1}`} onClick={()=>setAdditionalItems(items=>items.filter((_,i)=>i!==index))}>移除</Button></div>)}
        <Button disabled={additionalItems.length>=50} onClick={()=>setAdditionalItems(items=>[...items,''])}>添加补充项目</Button>
      </FormSection>:null}
      {action==='record-hours'?<><Alert type="info" title="检验通过时填写本轮维修的实际工时，并一并保存。"/><Form.Item label="实际工时（小时）" required><InputNumber aria-label="实际工时" min={0.01} max={10000} precision={2} value={workHours} onChange={value=>{setWorkHours(value);setError('');}}/></Form.Item></>:null}
      {error||controller.error?<Alert type="error" showIcon title={error||controller.error}/>:null}
      {(assign&&!historical)||action==='update'?<FormSection title="执行方式"><DispatchExecutionFields contractors={controller.people.contractors} value={execution} onChange={setExecution} allowModeChange={assign} hideFee={reopening||Boolean(task.repairRound)}/></FormSection>:null}
      {assign && <FormSection title="人员安排与说明">
      {assign&&execution.executionMode!=='outsourced'?<Form.Item label="维修员工（可多选，平级协作）" required><Select mode="multiple" aria-label="维修工" value={technicianIds} onChange={ids=>{setTechnicianIds(ids);projectDraft.changeTeam(ids);}} placeholder="选择同店维修员工" options={controller.people.technicians.map(p=>({value:p.id,label:`${personDisplayName(p,controller.people.technicians)} · 当前 ${controller.summaries.find(s=>s.id===p.id)?.current||0} 单`}))}/></Form.Item>:null}
      {assign&&execution.executionMode!=='outsourced'&&!controller.people.technicians.length?<Alert type="info" title="暂无可派维修工，请配置钉钉角色并让员工登录一次。"/>:null}
      {action==='reassign'?<Alert type="info" showIcon title="改派交接范围" description={<>
        <p>未完成项目交给{execution.executionMode==='outsourced'?execution.contractor||'承包方':technicianIds.map(id=>controller.people.technicians.find(p=>p.id===id)?.name||id).join('、')||'新维修团队'}：{task.items.filter(i=>!['待检验','已完工'].includes(i.status)).map(i=>i.name).join('、')||'无'}。{execution.executionMode!=='outsourced'&&technicianIds.length>1?'接单后须逐项确认负责人。':''}</p>
        <p>待检验项目保留原维修责任：{task.items.filter(i=>i.status==='待检验').map(i=>`${i.name}（${i.responsibleName||'原负责人'}）`).join('、')||'无'}。</p>
        <p>已通过项目保留负责人和检验结果，原维修参与人员不能自检。</p>
      </>}/>:null}
      {assign?<Alert type="info" title={execution.executionMode==='outsourced'?'外包人员可接单并维护维修进度，完工后需独立检验。':'所选员工共同维护工单进度，任一人确认即代表工单接单；每次操作均记录实际操作人。'}/>:null}
      </FormSection>}
      {action==='assign'?<FormSection title="维修项目与负责人"><RepairItemsEditor items={task.items} rows={assignmentRows} onChange={projectDraft.change} editing disabled={controller.busy} showResponsibilities={execution.executionMode!=='outsourced'} technicians={controller.people.technicians.filter(p=>technicianIds.includes(p.id))}/>{projectDraft.stale?<Alert type="warning" title="工单已更新，请关闭窗口重新派工"/>:null}</FormSection>:null}
      <FormSection className={action==='inspect'?'inspection-notes':undefined} title={scheduling ? "时间与备注" : action==='inspect'?'备注':"操作说明"}>
      {scheduling?<><Form.Item label="预计完工时间" required><Input aria-label="预计完工时间" type="datetime-local" value={dueAt} onChange={e=>setDueAt(e.target.value)}/></Form.Item><Checkbox checked={urgent} onChange={e=>setUrgent(e.target.checked)}>加急任务</Checkbox></>:null}
      {['submit','reassign-inspection'].includes(action)?<Form.Item label="指定检验员" required><Select aria-label="指定检验员" placeholder="选择检验员或管理员" value={inspectorId} onChange={setInspectorId} options={controller.people.inspectors.filter(p=>!(task.technicianIds??[task.technicianId]).includes(p.id) && !task.participantIds?.includes(p.id) && !task.items.some(i=>i.startedBy===p.id||i.finishedBy===p.id)).map(p=>({value:p.id,label:personDisplayName(p,controller.people.inspectors)}))}/></Form.Item>:null}
      {action==='pause'?<Form.Item label="暂停原因"><Select aria-label="暂停原因" value={pauseReason} onChange={setPauseReason} options={['待配件','待客户确认','技术问题','其他'].map(value=>({value,label:value}))}/></Form.Item>:null}

      {(['reopen-repair','decline','cancel','reassign','reconcile','reassign-inspection'].includes(action)||(action==='record-hours'&&task.workHours!==undefined))?<Form.Item label={reopening?"返工原因":"原因 / 交接说明"} required={reopening}><Input.TextArea aria-label="原因或交接说明" value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)} rows={3}/></Form.Item>:null}
      <Form.Item label={action==='submit'?'完工提报说明':action==='inspect'?(rejectedItemIds.length?'退回原因 / 备注':'备注（选填）'):'备注'} required={action==='inspect'&&rejectedItemIds.length>0}><Input.TextArea aria-label="备注" value={note} maxLength={2000} onChange={e=>setNote(e.target.value)} rows={3}/></Form.Item>
      {action==='reconcile'?<Alert type="warning" title={historical?"仅核对历史人员，不重新接单、不补发通知、不补造完成时间。":"确认归属后重新发起接单，保留已有项目进度，不补录历史时间。"}/>:null}
      </FormSection>
    </Form>
  </FormDialog>;
}
