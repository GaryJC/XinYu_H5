import {pendingPhotoWaivers} from '../../../../shared/repairPhotoWaiver.mjs';
import { useDetailScrollLock } from '../../shared/ui/useDetailScrollLock';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { ListPagination } from '../../shared/ui/ListPagination';
import { LoadingState } from "../../shared/ui/LoadingState";
import { hasRole, hasAnyRole } from "../../../../shared/roles.mjs";
import {DispatchFilterBar} from './DispatchFilterBar';
import { WarehousePartsPage } from './WarehousePartsPage';
import { TechnicianRepairPage } from './TechnicianRepairPage';
import { useEffect,useRef,useState } from 'react';
import { DispatchWorkloadBoard } from './DispatchWorkloadBoard';
import {DispatchWorkloadChart} from './DispatchWorkloadChart';
import {workloadLabels} from '../operations-dashboard/workloadLabels';
import { executionLabels } from './DispatchExecutionFields';
import { Alert,Button,Card,Drawer,Empty,Grid,Space,Table,Tag } from 'antd';
import type { DispatchMetric,DispatchTask,UserProfile } from '../../../../shared/types';
import { useDispatchController } from './useDispatchController';
import { DispatchTaskDetail } from './DispatchTaskDetail';
import { displayTime,metrics,statusFilters,taskStatusLabel,personDisplayName } from './dispatchLabels';
import './dispatch.css';
export function DispatchPage({user,view,initialStage}:{user:UserProfile;view:string;initialStage?:string}) {
  const c=useDispatchController(user,view,undefined,initialStage), mobile=!Grid.useBreakpoint().md;
  useDetailScrollLock(Boolean(c.selectedId));
  const update=(key:string,value:string|undefined)=>c.setFilters(f=>({...f,[key]:value}));
  const taskHeading=useRef<HTMLHeadingElement>(null);
  const [drawerReady,setDrawerReady]=useState(false);
  const inspection=view==='检验任务';
  useEffect(()=>{if(initialStage&&!c.loading)taskHeading.current?.scrollIntoView({block:'start'});},[initialStage,c.loading]);
  const clearWorkload=()=>c.setFilters(f=>({...f,workloadState:undefined,technicianId:undefined}));
  useEffect(()=>{if(c.filters.workloadState)taskHeading.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});},[c.filters.workloadState,c.filters.technicianId]);
  const chosen=c.summaries.find(s=>s.id===c.filters.technicianId);
  function badges(t:DispatchTask) {return <Space className="dispatch-badges" size={[8,8]} wrap>{pendingPhotoWaivers(t).length>0&&<Tag color="orange">无照片待审批</Tag>}<Tag>{executionLabels[t.executionMode||'internal']}</Tag><Tag color="blue">{taskStatusLabel(t)}</Tag>{!!t.inspectionDeferredCount&&<Tag color="orange">待定 × {t.inspectionDeferredCount}</Tag>}{t.pendingRepairCount?<Tag color="orange">存在待客户确认项目</Tag>:null}{t.urgent?<Tag color="red">加急</Tag>:null}{t.overdue?<Tag color="red">超期</Tag>:null}{t.repairRound?<Tag color="orange">{t.roundKind==='additional'?'追加维修第':'返工第'} {t.repairRound} 轮</Tag>:t.rework?<Tag color="orange">返工</Tag>:null}{t.feedback?<Tag color="orange">无法接单</Tag>:null}{t.needsReview?<Tag>待核对</Tag>:null}</Space>;}
  if(view==='配件申请' && hasRole(user, 'warehouse')) return <WarehousePartsPage controller={c}/>;
  if(view==='我的维修' && (hasAnyRole(user, ['technician','outsourcing'])||user.outsourcingRoleMember)) return <TechnicianRepairPage controller={c} user={user}/>;
  return <section className="dispatch-page" aria-label={view}>
    <div className="dispatch-heading"><div>{c.updatedAt&&<p>更新于 {c.updatedAt}</p>}</div><Button icon={<RefreshCw size={16} aria-hidden="true" />} onClick={()=>{c.setError('');void c.refresh();}} loading={c.loading}>刷新</Button></div>
    {c.error?<Alert type="error" showIcon closable title={c.error} onClose={()=>c.setError('')}/>:null}
    <DispatchFilterBar controller={c} inspection={inspection}/>
    {c.manager&&view==='派工台'?<DispatchWorkloadChart refreshKey={c.updatedAt} filters={c.filters} onClear={clearWorkload} onSelect={(technicianId,workloadState)=>c.setFilters(f=>({sort:f.sort,search:f.search,includeCompleted:f.includeCompleted,technicianId,workloadState}))}/>:c.inspectionLead?<DispatchWorkloadBoard summaries={c.summaries} filters={c.filters} onSelect={(technicianId,metric)=>{
      c.setFilters(f=>({sort:f.sort,search:f.search,includeCompleted:f.includeCompleted,from:f.from,to:f.to,technicianId,metric}));
      if(mobile) taskHeading.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
    }}/>:null}
    <div className="dispatch-heading"><h3 ref={taskHeading} className="dispatch-task-heading">{chosen?`${personDisplayName(chosen,c.summaries)} · `:''}{c.filters.workloadState?workloadLabels[c.filters.workloadState]:c.filters.metric?(c.filters.metric==='current'?'当前任务':metrics[c.filters.metric as DispatchMetric]):(c.filters.includeCompleted==='true'&&!c.filters.stage?'全部工单':(c.filters.stage==='无照片待审批'?'无照片待审批':statusFilters.find(option=>option.value===(c.filters.stage||''))?.label)||'维修任务')}（{c.list.total}{c.filters.workloadState?' 单':''}）</h3>{c.filters.workloadState?<Button onClick={clearWorkload}>清除负荷筛选</Button>:c.filters.metric?<Button onClick={()=>update('metric',undefined)}>清除数量筛选</Button>:null}</div>
    {mobile && c.loading && <LoadingState label="正在加载维修任务…" />}
    {!c.loading&&!c.tasks.length?<Empty description="没有符合条件的维修任务"/>:mobile?<div className="dispatch-task-cards">{c.tasks.map(t=><Card key={t.orderId} className="dispatch-task-card" size="small" title={t.plate||'未填写车牌'} extra={<ChevronRight size={18} aria-hidden="true" />} role="button" tabIndex={0} aria-label={`查看维修任务 ${t.plate||t.dispatchNo||t.orderId}`}
      onClick={()=>c.select(t.orderId)}
      onKeyDown={event=>{if(event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();c.select(t.orderId);}}}>
      {badges(t)}
      <p className="dispatch-order-number"><span>{t.dispatchNo ? "派工号" : "委托单号"}</span>{t.dispatchNo||t.orderId}</p>
      <div className="dispatch-task-info">
        <div><span>服务顾问</span><strong>{t.advisor||'未填写'}</strong></div>
        <div><span>维修人员</span><strong>{t.technicianName||'待指派'}</strong></div>
        <div className="dispatch-task-project-summary"><span>维修项目 · {t.items.length} 项</span><span>{t.items.map(i=>i.name).join('、')}</span></div>
        <div className="dispatch-task-due"><span>预计完工</span><span>{displayTime(t.dueAt)}</span></div>
      </div>
      <div className="dispatch-task-progress"><div><span>已提报或通过</span><strong>{t.items.filter(i=>['待检验','已完工'].includes(i.status)).length} / {t.items.length}</strong></div><progress aria-label="已提报或通过的维修项目" value={t.items.filter(i=>['待检验','已完工'].includes(i.status)).length} max={Math.max(1,t.items.length)} /></div>
    </Card>)}</div>:<Table className="dispatch-task-table" loading={c.loading} rowKey="orderId" dataSource={c.tasks} pagination={false} scroll={{x:1100}} columns={[
      {title:'车辆 / 单号',key:'order',render:(_,t)=><><Button type="link" onClick={()=>c.select(t.orderId)}>{t.plate}</Button><div className="dispatch-muted">{t.dispatchNo||t.orderId}</div></>},
      {title:'服务顾问',dataIndex:'advisor',render:value=>value||'未填写'},
      {title:'维修员工 / 承包方',dataIndex:'technicianName',render:value=>value||'待指派'},
      {title:'阶段',key:'stage',render:(_,t)=>badges(t)},
      {title:'维修内容',key:'items',render:(_,t)=><div className="dispatch-summary">{t.items.map(i=>i.name).join('、')}</div>},
      {title:'项目进度',key:'progress',render:(_,t)=>`${t.items.filter(i=>['待检验','已完工'].includes(i.status)).length}/${t.items.length}`},
      {title:'预计完工',dataIndex:'dueAt',render:displayTime},
      {title:'操作',key:'action',render:(_,t)=><Button onClick={()=>c.select(t.orderId)}>详情</Button>}
    ]}/>}
    <ListPagination mobile={mobile} page={c.list.page} total={c.list.total} loaded={c.tasks.length} loading={c.loading} onPage={c.list.setPage} onMore={c.list.loadMore}/>
    <Drawer afterOpenChange={setDrawerReady} className="repair-task-drawer" open={Boolean(c.selectedId)} onClose={()=>{if(!c.busy)c.select(undefined);}} title={c.detail?`${c.detail.task.plate} · 维修任务`:'维修任务'} size={mobile?'100%':700} destroyOnHidden>
      {c.detail||c.selectedId?<DispatchTaskDetail key={c.detail?.task.orderId||c.selectedId} controller={c} user={user} readyForFocus={drawerReady}/>:null}
    </Drawer>
  </section>;
}
