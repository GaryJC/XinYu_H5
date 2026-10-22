import {personalTask,individualRepair} from './individualRepair';
import { RepairStatusTag } from './RepairStatusTag';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Drawer, Empty, Grid, Input, Segmented, Tag } from 'antd';
import type { UserProfile } from '../../../../shared/types';
import type { DispatchController } from './useDispatchController';
import {partsStatus} from './partsProgress';
import { displayTaskTime, taskStatusLabel } from './dispatchLabels';
import { TechnicianTaskDetail } from './TechnicianTaskDetail';
const categories=[{label:'待接单',value:'待接单',key:'pendingAccept'},{label:'进行中',value:'进行中',key:'inProgress'},{label:'待检验',value:'待检验',key:'inspection'},{label:'已完成',value:'维修完成',key:'completed'}] as const;
export function TechnicianRepairPage({controller:c,user}:{controller:DispatchController;user:UserProfile}) {
  useEffect(()=>{if(!c.filters.stage)c.setFilters({stage:'进行中'});},[c.filters.stage,c.setFilters]);
  const mobile=!Grid.useBreakpoint().md;
  const [photoBlocked,setPhotoBlocked]=useState(false);
  return <section className="dispatch-page technician-page" aria-label="我的维修">
    <div className="dispatch-heading"><h2>我的维修</h2><Button loading={c.loading} onClick={()=>void c.refresh()}>刷新</Button></div>
    <Input.Search aria-label="搜索我的维修" placeholder="车牌 / 委托单号 / 派工号" allowClear onSearch={search=>c.setFilters({...c.filters,search})}/>
    <Segmented className="repair-task-tabs" block options={categories.map(category=>({value:category.value,className:(c.filters.stage||'进行中')===category.value?'repair-tab-active':undefined,label:`${category.label}（${c.taskCounts?.[category.key]??'—'}）`}))} value={c.filters.stage||'进行中'} onChange={stage=>c.setFilters({...c.filters,stage})} aria-label="维修任务分类"/>
    {c.filters.stage==='维修完成'?<p className="dispatch-muted">显示本月完成的维修任务</p>:null}
    {c.error?<Alert type="error" title={c.error} closable onClose={()=>c.setError('')}/>:null}
    {!c.loading&&!c.tasks.length?<Empty description="暂无此类维修任务"/>:null}
    <div className="technician-task-list">{c.tasks.map(task=><Card key={task.orderId} className="technician-task-card">
      <div className="dispatch-heading"><h3>{task.plate||'未填写车牌'}</h3><RepairStatusTag status={taskStatusLabel(task)}/></div>
      <div className="technician-flags">{task.urgent?<Tag color="red">加急</Tag>:null}{task.overdue?<Tag color="red">超期</Tag>:null}{task.repairRound?<Tag color="orange">返工第 {task.repairRound} 轮</Tag>:task.rework?<Tag color="orange">返工</Tag>:null}</div>
      {['待开工','维修中','暂停'].includes(task.stage)?<p className="technician-parts-progress">配件：{personalTask(task,user.id).partsRequirement?partsStatus(personalTask(task,user.id).partsRequirement):'未登记需求'}</p>:null}
      <p>{personalTask(task,user.id).items.map(i=>i.name).join('、')||'暂无本人维修项目'}</p>{individualRepair(task)&&personalTask(task,user.id).items.length>0&&personalTask(task,user.id).items.every(i=>['待检验','已完工'].includes(i.status))&&task.stage==='维修中'?<Tag color="green">本人已提交 · 等待其他项目</Tag>:null}
      <p className="dispatch-muted">预计完工：{displayTaskTime(task.dueAt)}</p>
      <Button type="primary" block onClick={()=>c.select(task.orderId)}>{task.stage==='待接单'?'查看并接单':task.stage==='待检验'?'查看检验进度':task.stage==='维修完成'?'查看维修记录':'进入维修'}</Button>
    </Card>)}</div>
    <Drawer className="repair-task-drawer" title={c.detail?.task.plate||'维修任务'} open={Boolean(c.selectedId)} size={mobile?'100%':640} mask={{closable:!c.busy&&!photoBlocked}} closable={!c.busy&&!photoBlocked} onClose={()=>{if(!c.busy&&!photoBlocked)c.select(undefined);}} destroyOnHidden>
      {c.detail?<TechnicianTaskDetail key={c.detail.task.orderId} controller={c} user={user} onPhotoBlocked={setPhotoBlocked}/>:<Empty description="正在加载维修任务"/>}
    </Drawer>
  </section>;
}
