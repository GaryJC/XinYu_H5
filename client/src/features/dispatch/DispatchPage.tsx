import { executionLabels } from './DispatchExecutionFields';
import { Alert,Button,Card,Checkbox,Collapse,Drawer,Empty,Grid,Input,Select,Space,Table,Tag } from 'antd';
import type { DispatchMetric,DispatchTask,UserProfile } from '../../../../shared/types';
import { useDispatchController } from './useDispatchController';
import { DispatchTaskDetail } from './DispatchTaskDetail';
import { displayTime,metrics,statusFilters,taskStatusLabel,personDisplayName } from './dispatchLabels';
import './dispatch.css';
export function DispatchPage({user,view}:{user:UserProfile;view:string}) {
  const c=useDispatchController(user,view), mobile=!Grid.useBreakpoint().md;
  const update=(key:string,value:string|undefined)=>c.setFilters(f=>({...f,[key]:value}));
  const chosen=c.summaries.find(s=>s.id===c.filters.technicianId);
  function badges(t:DispatchTask) {return <Space className="dispatch-badges" size={[8,8]} wrap><Tag>{executionLabels[t.executionMode||'internal']}</Tag><Tag color="blue">{taskStatusLabel(t)}</Tag>{t.urgent?<Tag color="red">加急</Tag>:null}{t.overdue?<Tag color="red">超期</Tag>:null}{t.rework?<Tag color="orange">返工</Tag>:null}{t.feedback?<Tag color="orange">无法接单</Tag>:null}{t.needsReview?<Tag>待核对</Tag>:null}</Space>;}
  return <section className="dispatch-page" aria-label={view}>
    <div className="dispatch-heading"><div><h2>{view}</h2><p>{c.manager?'默认显示本店全部未完结工单，可按状态筛选并安排维修与检验。':'及时确认任务，记录项目进度。'}{c.updatedAt?` 更新于 ${c.updatedAt}`:''}</p></div><Button onClick={()=>{c.setError('');void c.refresh();}} loading={c.loading}>刷新</Button></div>
    {c.error?<Alert type="error" showIcon closable title={c.error} onClose={()=>c.setError('')}/>:null}
    <Card size="small" className="dispatch-filter-card">
      <div className="dispatch-filters">
      <label>搜索<Input.Search aria-label="搜索派工任务" placeholder="车牌 / 委托单号 / 派工号" allowClear onSearch={value=>update('search',value)}/></label>
      <label>工单状态<Select aria-label="工单状态筛选" value={c.filters.stage||''} onChange={value=>c.setFilters(f=>({...f,stage:value||undefined,metric:undefined}))} options={statusFilters} popupMatchSelectWidth={220}/></label>
      <label>执行方式<Select aria-label="筛选执行方式" allowClear placeholder="全部方式" value={c.filters.executionMode} onChange={value=>update('executionMode',value)} options={Object.entries(executionLabels).map(([value,label])=>({value,label}))}/></label>

      {c.manager?<label>维修工<Select aria-label="筛选维修工" allowClear placeholder="全部维修工" value={c.filters.technicianId} onChange={value=>{c.setFilters(f=>({...f,technicianId:value,metric:undefined}));}} options={c.summaries.map(p=>({value:p.id,label:`${personDisplayName(p,c.summaries)}${p.active?'':'（停用）'}`}))}/></label>:null}
      </div><div className="dispatch-filter-actions"><div className="dispatch-filter-toggles"><Checkbox checked={c.filters.urgent==='true'} onChange={e=>update('urgent',e.target.checked?'true':undefined)}>仅加急</Checkbox>
      <Checkbox checked={c.filters.overdue==='true'} onChange={e=>update('overdue',e.target.checked?'true':undefined)}>仅超期</Checkbox>
      </div><Button onClick={()=>c.setFilters({})}>重置筛选</Button>
    </div><details className="dispatch-date-filter"><summary>完成日期范围</summary><div className="dispatch-date-fields">      <label>完成记录起始日期<Input aria-label="完成记录起始日期" type="date" value={c.filters.from||''} onChange={e=>update('from',e.target.value)}/></label>
      <label>完成记录结束日期<Input aria-label="完成记录结束日期" type="date" value={c.filters.to||''} onChange={e=>update('to',e.target.value)}/></label>
</div><p className="dispatch-muted">仅筛选已完结记录和个人完成量，默认本月。</p></details><p className="dispatch-filter-hint">默认显示全部未完结工单，含待结算。</p></Card>
    {c.manager?<Collapse className="dispatch-workload" defaultActiveKey={mobile?[]:['people']} items={[{key:'people',label:`维修工负荷 · ${c.summaries.length} 人`,children:<Card size="small" variant="borderless" className="dispatch-people">
      <p className="dispatch-muted">点击数量查看对应工单。“尚未开工”包含其中的待接单单据；超期和返工是附加标记，各列不可直接相加。多人协作分别计入个人负荷和参与完成量，工单列表每单只计一次，人员完成量不可相加作为整店完成量。</p>
      {mobile?<div className="dispatch-person-cards">{c.summaries.map(p=><Card key={p.id} size="small" title={`${personDisplayName(p,c.summaries)}${p.active?'':'（停用）'} · 当前 ${p.current} 单`}><div className="dispatch-metrics">{Object.entries(metrics).map(([key,label])=><Button key={key} type="text" onClick={()=>c.setFilters(f=>({from:f.from,to:f.to,technicianId:p.id,metric:key}))}>{label} {p[key as DispatchMetric]}</Button>)}</div></Card>)}</div>:<Table size="small" pagination={false} scroll={{x:850}} rowKey="id" dataSource={c.summaries} columns={[
        {title:'维修工',dataIndex:'name',render:(name,p)=><span>{personDisplayName(p,c.summaries)}{p.active?'':'（停用）'}</span>},
        {title:'当前任务',dataIndex:'current',render:(value,p)=><Button type="link" onClick={()=>c.setFilters(f=>({from:f.from,to:f.to,technicianId:p.id,metric:'current'}))}>{value}</Button>},
        ...Object.entries(metrics).map(([key,label])=>({title:label,key,render:(_:unknown,p:typeof c.summaries[number])=><Button type="link" aria-label={`${personDisplayName(p,c.summaries)}${label}${p[key as DispatchMetric]}单`} onClick={()=>c.setFilters(f=>({from:f.from,to:f.to,technicianId:p.id,metric:key}))}>{p[key as DispatchMetric]}</Button>}))
      ]}/>} 
      {!c.summaries.length?<Alert type="info" title="暂无维修工，请先配置钉钉角色，并让员工登录一次。"/>:null}
    </Card>}]} />:null}
    <div className="dispatch-heading"><h3>{chosen?`${personDisplayName(chosen,c.summaries)} · `:''}{c.filters.metric?(c.filters.metric==='current'?'当前任务':metrics[c.filters.metric as DispatchMetric]):(statusFilters.find(option=>option.value===(c.filters.stage||''))?.label||'维修任务')}（{c.tasks.length}）</h3>{c.filters.metric?<Button onClick={()=>update('metric',undefined)}>清除数量筛选</Button>:null}</div>
    {!c.loading&&!c.tasks.length?<Empty description="没有符合条件的维修任务"/>:mobile?<div className="dispatch-task-cards">{c.tasks.map(t=><Card key={t.orderId} className="dispatch-task-card" size="small" title={t.plate||'未填写车牌'} extra={<Button type="link" onClick={()=>c.select(t.orderId)}>查看任务</Button>}>
      {badges(t)}
      <p className="dispatch-order-number">{t.dispatchNo||t.orderId}</p>
      <div className="dispatch-task-info">
        <div><span>维修人员</span><strong>{t.technicianName||'待指派'}</strong></div>
        <div><span>维修项目</span><span>{t.items.map(i=>i.name).join('、')}</span></div>
        <div><span>预计完工</span><span>{displayTime(t.dueAt)}</span></div>
      </div>
      <div className="dispatch-task-progress"><span>项目完成</span><strong>{t.items.filter(i=>['待检验','已完工'].includes(i.status)).length} / {t.items.length}</strong></div>
    </Card>)}</div>:<Table loading={c.loading} rowKey="orderId" dataSource={c.tasks} pagination={{pageSize:20,showSizeChanger:false}} scroll={{x:1100}} columns={[
      {title:'车辆 / 单号',key:'order',render:(_,t)=><><Button type="link" onClick={()=>c.select(t.orderId)}>{t.plate}</Button><div className="dispatch-muted">{t.dispatchNo||t.orderId}</div></>},
      {title:'维修员工 / 承包方',dataIndex:'technicianName',render:value=>value||'待指派'},
      {title:'阶段',key:'stage',render:(_,t)=>badges(t)},
      {title:'维修内容',key:'items',render:(_,t)=><div className="dispatch-summary">{t.items.map(i=>i.name).join('、')}</div>},
      {title:'项目进度',key:'progress',render:(_,t)=>`${t.items.filter(i=>['待检验','已完工'].includes(i.status)).length}/${t.items.length}`},
      {title:'预计完工',dataIndex:'dueAt',render:displayTime},
      {title:'操作',key:'action',render:(_,t)=><Button onClick={()=>c.select(t.orderId)}>详情</Button>}
    ]}/>} 
    <Drawer open={Boolean(c.selectedId)} onClose={()=>{if(!c.busy)c.select(undefined);}} title={c.detail?`${c.detail.task.plate} · 维修任务`:'维修任务'} size={mobile?'100%':700} destroyOnHidden>
      {c.detail||c.selectedId?<DispatchTaskDetail key={c.detail?.task.orderId||c.selectedId} controller={c} user={user}/>:null}
    </Drawer>
  </section>;
}
