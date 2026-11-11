import {RefreshButton} from '../../shared/ui/RefreshButton';
import { TechnicianDateFilter } from './TechnicianDateFilter';
import { ListPagination } from '../../shared/ui/ListPagination';
import { LoadingState } from "../../shared/ui/LoadingState";
import { searchAllFilters,selectStatusFilters } from './useDispatchFilterDraft';
import { TechnicianTaskCard } from './TechnicianTaskCard';
import { useEffect, useState } from 'react';
import { Alert, Drawer, Empty, Grid, Input } from 'antd';
import type { UserProfile } from '../../../../shared/types';
import type { DispatchController } from './useDispatchController';
import { TechnicianTaskDetail } from './TechnicianTaskDetail';
import './technician-repair.css';
const categories=[{label:'回审 · 维修中',value:'回审&维修中',key:'actionable'},{label:'待接单',value:'待接单',key:'pendingAccept'},{label:'待开工',value:'待开工',key:'unstarted'},{label:'维修中',value:'维修中',key:'inProgress'},{label:'暂停',value:'暂停',key:'paused'},{label:'返工',value:'返工',key:'rework'},{label:'待检验',value:'待检验',key:'inspection'},{label:'回审',value:'回审',key:'review'},{label:'已完成',value:'已完成',key:'completed'}] as const;
export function TechnicianRepairPage({controller:c,user}:{controller:DispatchController;user:UserProfile}) {
  useEffect(()=>{if(!c.filters.stage&&c.filters.includeCompleted!=='true')c.setFilters(current=>({...current,stage:'回审&维修中'}));},[c.filters.stage,c.filters.includeCompleted,c.setFilters]);
  const mobile=!Grid.useBreakpoint().md;
  const [photoBlocked,setPhotoBlocked]=useState(false);
  return <section className="dispatch-page technician-page" aria-label="我的维修">
    <div className="technician-search-panel">
    <div className="technician-search-toolbar">
    <Input.Search aria-label="搜索我的维修" placeholder="车牌 / 委托单号 / 派工号" allowClear onSearch={search=>c.setFilters(current=>({...searchAllFilters(search),assignedFrom:current.assignedFrom,assignedTo:current.assignedTo,sort:current.sort}))}/>
    <RefreshButton className="technician-refresh" aria-label="刷新我的维修" title="刷新" loading={c.loading} disabled={c.loading} onClick={()=>void c.refresh()}/>
    </div>
    <TechnicianDateFilter filters={c.filters} setFilters={c.setFilters}/>
    <div className="technician-status-filters" role="group" aria-label="维修任务分类">
      {[...(c.filters.search||c.filters.includeCompleted==='true'?[{label:'全部',value:'all',key:'all'}]:[]),...categories].map(category=><button
        type="button" key={category.value}
        aria-pressed={(c.filters.stage||(c.filters.includeCompleted==='true'?'all':'回审&维修中'))===category.value}
        onClick={()=>c.setFilters(current=>selectStatusFilters(current,category.value))}
      ><span>{category.label}</span><span className="technician-status-count">{c.list.counts?.[category.value]??'—'}</span></button>)}
    </div>
    </div>
    {c.error?<Alert type="error" title={c.error} closable onClose={()=>c.setError('')}/>:null}
    {c.loading && <LoadingState label="正在加载维修任务…" />}
    {!c.loading&&!c.tasks.length?<Empty description="暂无此类维修任务"/>:null}
    <div className="technician-task-list">{c.tasks.map(task=><TechnicianTaskCard key={task.orderId} task={task} userId={user.id} onOpen={()=>c.select(task.orderId)}/>)}</div>
    <ListPagination mobile={mobile} page={c.list.page} total={c.list.total} loaded={c.tasks.length} loading={c.loading} onPage={c.list.setPage} onMore={c.list.loadMore}/>
    <Drawer className="repair-task-drawer technician-task-drawer" title={c.detail?.task.plate?`${c.detail.task.plate} · 我的维修`:'维修任务'} open={Boolean(c.selectedId)} size={mobile?'100%':640} mask={{closable:!c.busy&&!photoBlocked}} closable={!c.busy&&!photoBlocked} onClose={()=>{if(!c.busy&&!photoBlocked)c.select(undefined);}} destroyOnHidden>
      {c.detail?<TechnicianTaskDetail key={c.detail.task.orderId} controller={c} user={user} onPhotoBlocked={setPhotoBlocked}/>:<>{c.detailLoading?<LoadingState label="正在加载维修任务…" />:c.error?<Alert type="error" title={c.error}/>:null}</>}
    </Drawer>
  </section>;
}
