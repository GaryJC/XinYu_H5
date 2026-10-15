import { RepairStatusTag } from './RepairStatusTag';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Drawer, Empty, Grid, Segmented, Tag } from 'antd';
import type { UserProfile } from '../../../../shared/types';
import type { DispatchController } from './useDispatchController';
import { displayTime, taskStatusLabel } from './dispatchLabels';
import { TechnicianTaskDetail } from './TechnicianTaskDetail';
const categories=[{label:'待接单',value:'待接单',className:'repair-category-pending'},{label:'进行中',value:'进行中',className:'repair-category-working'},{label:'待检验',value:'待检验',className:'repair-category-inspection'},{label:'已完成',value:'维修完成',className:'repair-category-completed'}];
export function TechnicianRepairPage({controller:c,user}:{controller:DispatchController;user:UserProfile}) {
  useEffect(()=>{if(!c.filters.stage)c.setFilters({stage:'进行中'});},[c.filters.stage,c.setFilters]);
  const mobile=!Grid.useBreakpoint().md;
  const [photoBlocked,setPhotoBlocked]=useState(false);
  return <section className="dispatch-page technician-page" aria-label="我的维修">
    <div className="dispatch-heading"><h2>我的维修</h2><Button loading={c.loading} onClick={()=>void c.refresh()}>刷新</Button></div>
    <Segmented block options={categories} value={c.filters.stage||'进行中'} onChange={stage=>c.setFilters({stage})} aria-label="维修任务分类"/>
    {c.filters.stage==='维修完成'?<p className="dispatch-muted">显示本月完成的维修任务</p>:null}
    {c.error?<Alert type="error" title={c.error} closable onClose={()=>c.setError('')}/>:null}
    {!c.loading&&!c.tasks.length?<Empty description="暂无此类维修任务"/>:null}
    <div className="technician-task-list">{c.tasks.map(task=><Card key={task.orderId} className="technician-task-card">
      <div className="dispatch-heading"><h3>{task.plate||'未填写车牌'}</h3><RepairStatusTag status={taskStatusLabel(task)}/></div>
      <div className="technician-flags">{task.urgent?<Tag color="red">加急</Tag>:null}{task.overdue?<Tag color="red">超期</Tag>:null}{task.rework?<Tag color="orange">返工</Tag>:null}</div>
      <p>{task.items.map(i=>i.name).join('、')||'暂无维修项目'}</p>
      <p className="dispatch-muted">预计完工：{displayTime(task.dueAt)}</p>
      <Button type="primary" block onClick={()=>c.select(task.orderId)}>{task.stage==='待接单'?'查看并接单':task.stage==='待检验'?'查看检验进度':task.stage==='维修完成'?'查看维修记录':'进入维修'}</Button>
    </Card>)}</div>
    <Drawer title={c.detail?.task.plate||'维修任务'} open={Boolean(c.selectedId)} size={mobile?'100%':640} mask={{closable:!c.busy&&!photoBlocked}} closable={!c.busy&&!photoBlocked} onClose={()=>{if(!c.busy&&!photoBlocked)c.select(undefined);}} destroyOnHidden>
      {c.detail?<TechnicianTaskDetail key={c.detail.task.orderId} controller={c} user={user} onPhotoBlocked={setPhotoBlocked}/>:<Empty description="正在加载维修任务"/>}
    </Drawer>
  </section>;
}
