import {Alert,Button,Select} from 'antd';
import {PencilLine} from 'lucide-react';
import type {UserProfile} from '../../../../shared/types';
import type {DispatchController} from './useDispatchController';
import {FormDialog} from '../../shared/ui/BusinessForm';
import {useTaskTechniciansEditor} from './useTaskTechniciansEditor';

export function TaskTechniciansEditor({controller:c,user,blocked=false}:{controller:DispatchController;user:UserProfile;blocked?:boolean}) {
  const e=useTaskTechniciansEditor(c,user,blocked);
  return <>
    <span className="task-due-display"><span>{e.task.technicianName||'待指派'}</span>{e.allowed&&<Button type="link" size="small" icon={<PencilLine size={14}/>} aria-label="编辑维修员工" disabled={c.busy||blocked} onClick={e.begin}>编辑</Button>}</span>
    <FormDialog title="修改维修员工" open={e.open} onCancel={e.close} onOk={()=>void e.save()} okText="保存" confirmLoading={c.busy} okButtonProps={{disabled:!e.valid}} cancelButtonProps={{disabled:c.busy}} closable={!c.busy} mask={{closable:!c.busy}}>
      <p>已分配维修项目或已有完工提检记录的员工不可移除。可补充维修员工，或移除未关联项目和提检记录的误选员工。</p>
      <label className="task-due-field"><span>维修员工</span><Select mode="multiple" aria-label="维修员工名单" style={{width:'100%'}} value={e.ids} options={e.options} onChange={e.change} disabled={c.busy||!e.allowed} optionFilterProp="label"/></label>
      {e.stale&&<Alert type="warning" showIcon title="任务已更新，请重新载入名单" action={<Button onClick={e.begin} disabled={c.busy}>重新载入</Button>}/>}
      {!e.allowed&&<Alert type="warning" showIcon title="当前工单或账号已不允许修改维修员工"/>}
      {e.failed&&c.error&&<Alert type="error" showIcon title={c.error}/>}
    </FormDialog>
  </>;
}
