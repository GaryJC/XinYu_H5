import {createPortal} from 'react-dom';
import {useState} from 'react';
import {Alert,Button,Checkbox,Form,Input} from 'antd';
import type {DispatchTask} from '../../../../shared/types';
import type {DispatchController} from './useDispatchController';
import {RepairItemsEditor} from './RepairItemsEditor';
import {useDispatchProjectDraft} from './useDispatchProjectDraft';
import {useInlineDispatch} from './useInlineDispatch';
import {useProjectBulkAssignment} from './useProjectBulkAssignment';
import {DispatchExecutionFields} from './DispatchExecutionFields';
import {DispatchItemProgressActions} from './DispatchItemProgressActions';
import {hasResponsibilityHandover} from './repairResponsibilityChanges';

export function DispatchProjectsEditor({task,controller:c,actionsTarget}:{task:DispatchTask;controller:DispatchController;actionsTarget:HTMLElement|null}) {
  const draft=useDispatchProjectDraft(task);
  const assignment=useInlineDispatch(task,()=>draft.change(draft.rows));
  const settlement=task.stage==='维修完成'&&task.orderStatus==='待结算'&&task.executionMode!=='outsourced';
  const bulk=useProjectBulkAssignment(draft.rows,task.items,draft.change,settlement);
  const pending=task.stage==='待派工';
  const [reason,setReason]=useState('');
  const handover=hasResponsibilityHandover(task,draft.rows);
  const needsOwners=(pending?assignment.execution.executionMode:task.executionMode)!=='outsourced';
  const validNames=draft.rows.length>0&&draft.rows.every(row=>row.name.trim()&&row.name.length<=200);
  const valid=draft.rows.length>0&&draft.rows.every(row=>row.name.trim()&&row.name.length<=200&&(!needsOwners||row.responsibleId||task.items.some(i=>i.id===row.id&&['待检验','已完工'].includes(i.status))));
  const reset=()=>{draft.reset();assignment.reset();bulk.clear();setReason('');};
  async function save(dispatch=false) {
    if(draft.stale||c.busy||!(pending&&!dispatch?validNames:valid)||dispatch&&!assignment.valid)return;
    if((handover||settlement)&&!reason.trim()){c.setError('请填写原因或交接说明');return;}
    const input=pending&&dispatch?assignment.request(draft.rows):{action:'edit-repair-items' as const,repairItems:pending?draft.rows.map(({id,name})=>({id,name})):draft.rows};
    if(await c.act({...input,...(handover||settlement?{reason:reason.trim()}:{})}))reset();
  }
  return <>
    {settlement?<Alert type="info" showIcon title="重新分配后退回正在维修" description="仅改派项目回到待开工，未调整项目保留检验结果。请填写重新分配原因。"/>:null}
    <RepairItemsEditor allowCompletedAssignment={settlement} items={task.items} rows={draft.rows} onChange={bulk.changeRows} onResponsibleChange={bulk.assign} allowRemoval editing disabled={c.busy} technicians={c.people.technicians} showResponsibilities={needsOwners} selection={needsOwners?{selected:bulk.selected,onChange:bulk.setSelected}:undefined} renderItemActions={item=><DispatchItemProgressActions task={task} item={item} controller={c} enabled={c.manager&&task.executionMode==='outsourced'&&!draft.dirty}/>}/>
    {handover||settlement?<Form layout="vertical"><Form.Item label="原因 / 交接说明" required><Input.TextArea aria-label="原因或交接说明" value={reason} maxLength={2000} disabled={c.busy} onChange={e=>setReason(e.target.value)} rows={3}/></Form.Item></Form>:null}
    {!pending&&task.executionMode==='outsourced'&&draft.dirty?<p role="status">请先保存或取消项目修改，再更新外包进度。</p>:null}
    {pending?<Form layout="vertical" className="inline-dispatch-form">
      <h4>派工安排</h4>
      <DispatchExecutionFields contractors={c.people.contractors} value={assignment.execution} onChange={assignment.changeExecution} disabled={c.busy} hideFee={Boolean(task.repairRound)}/>
      <Form.Item label="预计完工时间" required><Input aria-label="预计完工时间" type="datetime-local" disabled={c.busy} value={assignment.dueAt} onChange={e=>assignment.changeDueAt(e.target.value)}/></Form.Item>
      <Checkbox disabled={c.busy} checked={assignment.urgent} onChange={e=>assignment.changeUrgent(e.target.checked)}>加急任务</Checkbox>
      <Form.Item label="派工备注"><Input.TextArea aria-label="派工备注" disabled={c.busy} value={assignment.note} maxLength={2000} rows={2} onChange={e=>assignment.changeNote(e.target.value)}/></Form.Item>
      <div className="inline-dispatch-actions"><Button disabled={c.busy||!draft.dirty} onClick={reset}>取消修改</Button><Button disabled={c.busy||!draft.dirty||!validNames||draft.stale} onClick={()=>void save()}>仅保存项目</Button><Button type="primary" loading={c.busy} disabled={!valid||!assignment.valid||draft.stale} onClick={()=>void save(true)}>确认派工并通知</Button></div>
      <p className="dispatch-muted">逐项选择负责人；勾选多个项目后，在选中项目中选择负责人即可统一修改。所有项目安排完毕后确认派工，将通知对应维修工。</p>
    </Form>:draft.dirty&&actionsTarget?createPortal(<div className="repair-items-save"><Button disabled={c.busy} onClick={reset}>取消修改</Button><Button type="primary" loading={c.busy} disabled={!valid||draft.stale} onClick={()=>void save()}>{settlement?'重新分配并退回维修':'保存维修项目'}</Button></div>,actionsTarget):null}
    {draft.stale?<Alert type="warning" showIcon title="工单已更新，请重新载入后编辑" action={<Button onClick={reset}>重新载入</Button>}/>:null}
    {needsOwners?<p className="dispatch-muted">可逐项选择本店维修工；勾选多项后，修改选中项目的负责人会同步到所有选中项。新增项目需由维修工开工。</p>:null}
    {!valid&&draft.dirty?<p role="status">{needsOwners?'请填写项目名称，并为每个未完成项目选择负责人。':'请填写项目名称。'}</p>:null}
  </>;
}
