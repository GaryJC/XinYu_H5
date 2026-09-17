import { DispatchExecutionFields } from './DispatchExecutionFields';
import { Alert, Button, Checkbox, Form, Input, Select } from 'antd';
import type { UserProfile, WorkOrderDispatchPlan } from '../../../../shared/types';

type Props={plan?:WorkOrderDispatchPlan|null;users:UserProfile[];shopId?:string;disabled:boolean;signed:boolean;technician?:string;onChange:(plan:WorkOrderDispatchPlan|null)=>void;onOpen:()=>void};
export function DraftDispatchFields({plan,users,shopId,disabled,signed,technician,onChange,onOpen}:Props) {
  const workers=users.filter(p=>p.active && p.role==='technician' && p.shopId===shopId);
  const options=workers.map(p=>({value:p.id,label:workers.filter(other=>other.name===p.name).length>1?`${p.name}（员工编号 ${p.id}）`:p.name}));
  const patch=(value:Partial<WorkOrderDispatchPlan>)=>onChange({...plan!,...value});
  const localTime=plan?.dueAt && Number.isFinite(Date.parse(plan.dueAt))?new Date(Date.parse(plan.dueAt)+8*3600000).toISOString().slice(0,16):'';
  return <section aria-label="开单派工" className="check-section">
    <h3>维修派工</h3>
    {signed ? <>
      <p>当前维修工：{technician || '待派工'}。可在派工台查看进度、指派或改派。</p>
      {plan?.activationError && <Alert type="warning" title={plan.activationError}/>}
      <Button onClick={onOpen}>前往派工</Button>
    </> : <>
      <p>可在开单时预选维修工，客户签字后自动派工并通知；也可暂不选择，签字提交润丰后再派工。</p>
      <Checkbox disabled={disabled} checked={Boolean(plan)} onChange={e=>onChange(e.target.checked?{technicianIds:[],executionMode:'internal',dueAt:'',urgent:false,note:''}:null)}>签字后自动派工</Checkbox>
      {plan && <>
        <fieldset disabled={disabled} style={{border:0,padding:0,margin:0}}><div className="dispatch-form"><DispatchExecutionFields disabled={disabled} value={plan} onChange={value=>onChange({...value,technicianIds:plan.technicianIds??(plan.technicianId?[plan.technicianId]:[]),dueAt:plan.dueAt,urgent:plan.urgent,note:plan.note})}/></div></fieldset>
        {plan.executionMode!=='outsourced'?<Form.Item label="预选维修工（可多选）"><Select mode="multiple" aria-label="预选维修工" allowClear showSearch optionFilterProp="label" disabled={disabled} value={plan.technicianIds??(plan.technicianId?[plan.technicianId]:[])} options={options} placeholder="选择共同维修的员工" onChange={technicianIds=>patch({technicianIds,technicianId:undefined})}/></Form.Item>:null}
        <Form.Item label="预计完工时间（上海时间）" required><Input type="datetime-local" aria-label="派工预计完工时间" disabled={disabled} value={localTime} onChange={e=>patch({dueAt:e.target.value?new Date(`${e.target.value}:00+08:00`).toISOString():''})}/></Form.Item>
        <Checkbox disabled={disabled} checked={plan.urgent} onChange={e=>patch({urgent:e.target.checked})}>加急维修</Checkbox>
        <Form.Item label="派工备注"><Input.TextArea aria-label="开单派工备注" disabled={disabled} maxLength={2000} value={plan.note} onChange={e=>patch({note:e.target.value})}/></Form.Item>
      </>}
    </>}
  </section>;
}
