import { WarehouseDispatchNumber } from './WarehouseDispatchNumber';
import { useState } from 'react';
import { Alert, Button, Card, Drawer, Empty, Input, Modal, Segmented, Space, Tag } from 'antd';
import type { DispatchController } from './useDispatchController';
import { WarehousePartsDetail } from './WarehousePartsDetail';
import { canProcessParts, isSupplementalParts, partsStatus } from './partsProgress';
import './warehouse.css';
import { displayTime } from './dispatchLabels';

export function WarehousePartsPage({controller:c}:{controller:DispatchController}) {
  const [status,setStatus]=useState('待备料'),[issuing,setIssuing]=useState(false);
  const pending=c.tasks.filter(canProcessParts);
  const matchesStatus=(task:typeof c.tasks[number],value:string)=>(['待备料','待领取'].includes(value)?canProcessParts(task)&&partsStatus(task.partsRequirement)===value:partsStatus(task.partsRequirement)===value);
  const tasks=c.tasks.filter(task=>matchesStatus(task,status));
  const detail=c.detail, parts=detail?.task.partsRequirement;
  const actionable=detail&&canProcessParts(detail.task);
  return <section className="dispatch-page" aria-label="配件申请">
    <div className="dispatch-heading"><div><h2>配件申请</h2><p>待处理 {pending.length} 单 · 备料完成通知领取，交接时确认出库并自动开工。</p></div><Button loading={c.loading} onClick={()=>{void c.refresh();void c.refreshDetail();}}>刷新</Button></div>
    {c.error?<Alert type="error" showIcon title={c.error}/>:null}
    <div className="warehouse-filters">
      <Input.Search aria-label="搜索配件申请" placeholder="车牌 / 委托单号 / 派工号" allowClear onSearch={search=>c.setFilters({search})}/>
      <Segmented className="repair-task-tabs" block aria-label="配件申请状态" value={status} onChange={setStatus} options={['待备料','待领取','已出库'].map(value=>({value,label:value})).map(option=>({...option,className:status===option.value?'repair-tab-active':undefined,label:`${option.label}（${c.tasks.filter(task=>matchesStatus(task,option.value)).length}）`}))}/>
    </div>
    {!c.loading && !tasks.length?<Empty description="暂无配件申请"/>:null}
    {tasks.map(task=><Card key={task.orderId} size="small" title={task.plate} extra={<Space size={4}><Tag color={task.partsRequirement?.issuedAt?'green':'orange'}>{partsStatus(task.partsRequirement)}</Tag>{isSupplementalParts(task.partsRequirement)?<Tag color="blue">补料</Tag>:null}</Space>}>
      <WarehouseDispatchNumber value={task.dispatchNo}/>
      <p>{task.repairRound?`返工第 ${task.repairRound} 轮`:'首次维修'} · {task.stage}</p>
      <p>申请人：{task.partsRequirement?.recordedName || '未记录'} · {displayTime(task.partsRequirement?.recordedAt)}</p>
      <Button onClick={()=>c.select(task.orderId)}>查看申请</Button>
    </Card>)}
    <Drawer destroyOnHidden title="配件申请详情" className="warehouse-drawer" open={Boolean(c.selectedId)} onClose={()=>{if(!c.busy){setIssuing(false);c.select();}}} size={600} styles={{wrapper:{maxWidth:'100vw'}}}
      footer={detail?<div className="warehouse-footer"><p>{actionable?(parts?.preparedAt?'实际交接时确认出库，系统记录领取人并自动开工。':'备料完成后将通知维修工领取。'):'当前申请无需处理，可查看历史记录。'}</p><Button block size="large" type={actionable?'primary':'default'} loading={c.busy} disabled={c.busy} onClick={()=>{if(actionable){if(parts?.preparedAt)setIssuing(true);else void c.act({action:'confirm-parts'});}else c.select();}}>{actionable?(parts?.preparedAt?isSupplementalParts(parts)?'确认补料出库':'确认出库':isSupplementalParts(parts)?'补料完成并通知领取':'备料完成并通知领取'):'关闭详情'}</Button></div>:null}>
      {c.error?<Alert type="error" showIcon title={c.error}/>:null}
      {!detail?<p role="status">正在加载申请…</p>:<WarehousePartsDetail key={detail.task.orderId} detail={detail} controller={c}/>}
    </Drawer>
    <Modal open={issuing&&Boolean(detail)} title={isSupplementalParts(parts)?'确认补料交接出库':'确认配件交接出库'} okText={isSupplementalParts(parts)?'确认补料出库':'确认出库'} confirmLoading={c.busy} okButtonProps={{disabled:!actionable||!parts?.preparedAt}} cancelButtonProps={{disabled:c.busy}} closable={!c.busy} mask={{closable:false}} onCancel={()=>{if(!c.busy)setIssuing(false);}} onOk={async()=>{if(await c.act({action:'issue-parts'}))setIssuing(false);}}>
      <p>领取人：{detail?.task.technicianName || parts?.recordedName || '未记录'}</p>
      <p>请确认本次申请的配件已全部交接。出库后待开工任务将自动进入维修中，暂停任务保留暂停状态。</p>
      {c.error?<Alert type="error" title={c.error}/>:null}
    </Modal>
  </section>;
}
