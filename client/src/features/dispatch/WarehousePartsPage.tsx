import { useState } from 'react';
import { Alert, Button, Card, Drawer, Empty, Input, Select, Space, Tag } from 'antd';
import type { DispatchController } from './useDispatchController';
import { PartsRequirementSummary } from './PartsRequirementSummary';
import { actionLabels, displayTime } from './dispatchLabels';

export function WarehousePartsPage({controller:c}:{controller:DispatchController}) {
  const [status,setStatus]=useState('pending');
  const pending=c.tasks.filter(t=>t.partsRequirement && t.partsRequirement.mode!=='none' && !t.partsRequirement?.confirmedAt);
  const tasks=c.tasks.filter(t=>status==='all' || (status==='pending'?pending.includes(t):Boolean(t.partsRequirement?.confirmedAt)));
  const detail=c.detail, parts=detail?.task.partsRequirement;
  return <section className="dispatch-page" aria-label="配件申请">
    <div className="dispatch-heading"><div><h2>配件申请</h2><p>待确认 {pending.length} 单 · 确认仅作留痕，不代表出库或入库。</p></div><Button loading={c.loading} onClick={()=>{void c.refresh();void c.refreshDetail();}}>刷新</Button></div>
    {c.error?<Alert type="error" showIcon title={c.error}/>:null}
    <Space wrap>
      <Input.Search aria-label="搜索配件申请" placeholder="车牌 / 委托单号 / 派工号" allowClear onSearch={search=>c.setFilters({search})}/>
      <Select aria-label="配件申请状态" value={status} onChange={setStatus} options={[{value:'pending',label:'待确认'},{value:'confirmed',label:'已确认'},{value:'all',label:'全部记录'}]}/>
    </Space>
    {!c.loading && !tasks.length?<Empty description="暂无配件申请"/>:null}
    {tasks.map(task=><Card key={task.orderId} size="small" title={task.plate} extra={<Tag color={task.partsRequirement?.confirmedAt?'green':'orange'}>{!task.partsRequirement?'历史申请':task.partsRequirement.mode==='none'?'无需配件':task.partsRequirement?.confirmedAt?'已确认':'待确认'}</Tag>}>
      <p>派工号：{task.dispatchNo || task.orderId} · {task.repairRound?`返工第 ${task.repairRound} 轮`:'首次维修'}</p>
      <p>申请人：{task.partsRequirement?.recordedName || '未记录'} · {displayTime(task.partsRequirement?.recordedAt)}</p>
      <Button onClick={()=>c.select(task.orderId)}>查看申请</Button>
    </Card>)}
    <Drawer title="配件申请详情" open={Boolean(c.selectedId)} onClose={()=>c.select()} size={560} styles={{wrapper:{maxWidth:'100vw'}}}>
      {c.error?<Alert type="error" showIcon title={c.error}/>:null}
      {!detail?<p role="status">正在加载申请…</p>:<>
        <h3>{detail.task.plate} · {detail.task.dispatchNo || detail.task.orderId}</h3>
        <p>托修单位：{detail.task.customerName || '未填写'} · 车型：{detail.task.vehicleModel || '未填写'}</p>
        <p>主修人：{detail.task.technicianName || '未记录'}</p>
        <PartsRequirementSummary value={parts}/>
        {parts && parts.mode!=='none' && !parts.confirmedAt?<Button type="primary" loading={c.busy} onClick={()=>void c.act({action:'confirm-parts'})}>确认配件申请</Button>:null}
        <h3>申请与确认记录</h3>
        {detail.events.filter(e=>['accept','record-parts','confirm-parts'].includes(e.action)).map(event=><Card size="small" key={event.id}>
          <p>{actionLabels[event.action as keyof typeof actionLabels]} · {event.actorName} · {displayTime(event.at)}</p>
          <p>{event.detail.repairRound?`返工第 ${event.detail.repairRound} 轮`:'首次维修'}</p>
          <PartsRequirementSummary value={event.detail.partsRequirement}/>
        </Card>)}
      </>}
    </Drawer>
  </section>;
}
