import {Alert,Button,Checkbox,Drawer,Input,Select,Tabs,theme} from 'antd';
import {ClockCircleOutlined,FilterOutlined,ThunderboltOutlined} from '@ant-design/icons';
import type {DispatchController} from './useDispatchController';
import {executionLabels} from './DispatchExecutionFields';
import {personDisplayName,statusFilters} from './dispatchLabels';
import {activeFilterCount,advancedFilterCount,useDispatchFilterDraft} from './useDispatchFilterDraft';
import './dispatch-filter-bar.css';
const inspectionStatuses=[{value:'',label:'全部未完结'},{value:'待检验',label:'待检验'},{value:'回审',label:'回审'},{value:'维修完成',label:'已检验'},{value:'完成',label:'已完结'}];
export function DispatchFilterBar({controller:c,inspection}:{controller:DispatchController;inspection:boolean}) {
 const {token}=theme.useToken(),f=useDispatchFilterDraft(c.filters,c.setFilters);
 const advanced=advancedFilterCount(c.filters),active=activeFilterCount(c.filters);
 const statuses=inspection?inspectionStatuses:statusFilters;
 const patch=(key:'executionMode'|'from'|'to'|'technicianId',value:string|undefined)=>{f.setDraft(d=>({...d,[key]:value,...(key==='technicianId'?{metric:undefined}:{})}));f.setError('');};
 return <>
  <div className="dispatch-filter-bar" role="search" aria-label="工单搜索筛选" style={{background:token.colorBgContainer,borderColor:token.colorBorderSecondary,color:token.colorText}}>
   <Input.Search aria-label="搜索派工任务" placeholder="车牌 / 委托单号 / 派工号" allowClear value={f.search} onChange={e=>f.setSearch(e.target.value)} onSearch={f.submitSearch} onCompositionStart={()=>{f.composing.current=true;}} onCompositionEnd={()=>{f.composing.current=false;}} enterKeyHint="search" autoComplete="off"/>
   <Tabs className="dispatch-status-tabs" aria-label="工单状态筛选" activeKey={c.filters.stage||''} type="line" tabBarGutter={0} onChange={stage=>c.setFilters(current=>({...current,stage:stage||undefined,metric:undefined}))} items={statuses.map(({value,label})=>({key:value,label}))}/>
   <p className="dispatch-status-scroll-hint">左右滑动查看更多状态 ↔</p>
   <div className="dispatch-quick-filters">
    <Button icon={<FilterOutlined/>} color={advanced?'primary':'default'} variant="outlined" aria-label={advanced?`筛选，${advanced} 项已生效`:'筛选'} onClick={f.begin}>筛选{advanced?` · ${advanced}`:''}</Button>
    <Button icon={<ThunderboltOutlined/>} aria-label="加急" aria-pressed={c.filters.urgent==='true'} color={c.filters.urgent==='true'?'primary':'default'} variant={c.filters.urgent==='true'?'filled':'outlined'} onClick={()=>c.setFilters(current=>({...current,urgent:current.urgent==='true'?undefined:'true'}))}>加急</Button>
    <Button icon={<ClockCircleOutlined/>} aria-label="超期" aria-pressed={c.filters.overdue==='true'} color={c.filters.overdue==='true'?'primary':'default'} variant={c.filters.overdue==='true'?'filled':'outlined'} onClick={()=>c.setFilters(current=>({...current,overdue:current.overdue==='true'?undefined:'true'}))}>超期</Button>
    {active?<Button className="dispatch-filter-clear" type="text" aria-label="重置筛选" onClick={f.clear}>{active} 项 · 清空</Button>:null}
   </div>
  </div>
  <Drawer className="dispatch-filter-drawer" title="筛选工单" placement="bottom" size="auto" open={f.open} onClose={f.cancel} destroyOnHidden styles={{wrapper:{maxHeight:'85vh'},body:{overflowY:'auto'}}} footer={<div className="dispatch-filter-footer"><Button onClick={f.reset}>重置</Button><Button type="primary" onClick={f.confirm}>查看工单</Button></div>}>
   <div className="dispatch-filter-fields">
    <fieldset><legend>执行方式</legend><Checkbox.Group aria-label="执行方式" value={f.draft.executionMode?.split(',')||[]} options={Object.entries(executionLabels).map(([value,label])=>({value,label}))} onChange={values=>patch('executionMode',values.length?values.join(','):undefined)}/><p>可多选，不选表示全部方式</p></fieldset>
    <fieldset><legend>统计日期范围</legend><div className="dispatch-filter-dates">
     <label>开始日期<Input aria-label="完成记录起始日期" type="date" value={f.draft.from||''} max={f.draft.to||undefined} onChange={e=>patch('from',e.target.value||undefined)}/></label>
     <label>结束日期<Input aria-label="完成记录结束日期" type="date" value={f.draft.to||''} min={f.draft.from||undefined} onChange={e=>patch('to',e.target.value||undefined)}/></label>
    </div><p>用于已完结记录、个人完成量和退回项目统计；退回按检验发生日期计算，未填写时默认本月。</p></fieldset>
    {c.inspectionLead?<label className="dispatch-filter-worker">维修工<Select aria-label="筛选维修工" allowClear placeholder="全部维修工" value={f.draft.technicianId} onChange={value=>patch('technicianId',value)} options={c.summaries.map(person=>({value:person.id,label:`${personDisplayName(person,c.summaries)}${person.active?'':'（停用）'}`}))}/></label>:null}
    {f.error?<Alert type="error" showIcon title={f.error}/>:null}
    <p className="dispatch-filter-note">全部未完结包含待结算工单。</p>
   </div>
  </Drawer>
 </>;
}
