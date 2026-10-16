import { useState } from 'react';
import { Alert, Button, Card, Drawer, Empty, Input, Select, Space, Tag } from 'antd';
import type { DispatchController } from './useDispatchController';
import { WarehousePartsDetail } from './WarehousePartsDetail';
import './warehouse.css';
import { displayTime } from './dispatchLabels';

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
    <Drawer destroyOnHidden title="配件申请详情" className="warehouse-drawer" open={Boolean(c.selectedId)} onClose={()=>c.select()} size={600} styles={{wrapper:{maxWidth:'100vw'}}}
      footer={detail?<div className="warehouse-footer"><p>确认仅作申请留痕，不代表出库或入库</p><Button block size="large" type={parts && parts.mode!=='none' && !parts.confirmedAt?'primary':'default'} loading={c.busy} onClick={()=>{if(parts && parts.mode!=='none' && !parts.confirmedAt) void c.act({action:'confirm-parts'});else c.select();}}>{parts && parts.mode!=='none' && !parts.confirmedAt?'确认配件申请':'关闭详情'}</Button></div>:null}>
      {c.error?<Alert type="error" showIcon title={c.error}/>:null}
      {!detail?<p role="status">正在加载申请…</p>:<WarehousePartsDetail detail={detail}/>}

    </Drawer>
  </section>;
}
