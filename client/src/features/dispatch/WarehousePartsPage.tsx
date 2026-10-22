import {CopyTextButton} from '../../shared/ui/CopyTextButton';
import {displayTime} from './dispatchLabels';
import {sortWarehouseRequests,type WarehouseRequestSort} from './warehouseRequestSort';
import {partsController,warehouseRequests} from './individualRepair';
import {WarehouseDispatchNumber} from './WarehouseDispatchNumber';
import {WarehouseWorkOrderDrawer} from './WarehouseWorkOrderDrawer';
import {RepairContext} from './RepairContext';
import { useState } from 'react';
import { Alert, Button, Card, Drawer, Empty, Input, Modal, Segmented, Select, Space, Tag } from 'antd';
import type { DispatchController } from './useDispatchController';
import { WarehousePartsDetail } from './WarehousePartsDetail';
import { canProcessParts, isSupplementalParts, partsStatus } from './partsProgress';
import './warehouse.css';

export function WarehousePartsPage({controller:source}:{controller:DispatchController}) {
  const [status,setStatus]=useState('待备料'),[issuing,setIssuing]=useState(false),[issueVersion,setIssueVersion]=useState<number>();
  const [workOrderId,setWorkOrderId]=useState<string>();
  const [sortOrder,setSortOrder]=useState<WarehouseRequestSort>('newest');
  const [selectedOwner,setSelectedOwner]=useState<string>();
  const available=source.detail?warehouseRequests([source.detail.task]):[];
  const owner=selectedOwner!==undefined&&available.some(t=>(t.partsRequirement?.ownerId||'')===selectedOwner)?selectedOwner:available.find(canProcessParts)?.partsRequirement?.ownerId||available[0]?.partsRequirement?.ownerId;
  const c=partsController(source,owner);
  const requests=warehouseRequests(source.tasks);
  const pending=requests.filter(canProcessParts);
  const matchesStatus=(task:typeof c.tasks[number],value:string)=>(['待备料','待领取'].includes(value)?canProcessParts(task)&&partsStatus(task.partsRequirement)===value:partsStatus(task.partsRequirement)===value);
  const tasks=sortWarehouseRequests(requests.filter(task=>matchesStatus(task,status)),sortOrder);
  const detail=c.detail, parts=detail?.task.partsRequirement;
  const actionable=detail&&canProcessParts(detail.task);
  return <section className="dispatch-page" aria-label="配件申请">
    <div className="dispatch-heading"><div><h2>配件申请</h2><p>待处理 {pending.length} 单 · 备料完成通知领取，交接时确认出库并自动开工。</p></div><Button loading={c.loading} onClick={()=>{void c.refresh();void c.refreshDetail();}}>刷新</Button></div>
    {c.error?<Alert type="error" showIcon title={c.error}/>:null}
    <div className="warehouse-filters">
      <Input.Search aria-label="搜索配件申请" placeholder="车牌 / 委托单号 / 派工号" allowClear onSearch={search=>c.setFilters({search})}/>
      <label className="warehouse-sort">排序
        <Select aria-label="配件申请排序" value={sortOrder} onChange={setSortOrder} options={[
          {value:'newest',label:'申请时间：最新在前'},
          {value:'oldest',label:'申请时间：最早在前'}
        ]}/>
      </label>
      <Segmented className="repair-task-tabs" block aria-label="配件申请状态" value={status} onChange={setStatus} options={['待备料','待领取','已出库'].map(value=>({value,label:value})).map(option=>({...option,className:status===option.value?'repair-tab-active':undefined,label:`${option.label}（${requests.filter(task=>matchesStatus(task,option.value)).length}）`}))}/>
    </div>
    {!c.loading && !tasks.length?<Empty description="暂无配件申请"/>:null}
    {tasks.map(task=><Card key={`${task.orderId}-${task.partsRequirement?.ownerId||'legacy'}`} className="warehouse-request-card" size="small" title="配件申请" role="button" tabIndex={0} aria-label={`查看配件申请 ${task.plate||task.orderId} ${task.dispatchNo||task.orderId}`}
      onClick={event=>{if(event.target instanceof Element&&event.target.closest('button'))return;setSelectedOwner(task.partsRequirement?.ownerId||'');c.select(task.orderId);}}
      onKeyDown={event=>{if(event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();setSelectedOwner(task.partsRequirement?.ownerId||'');c.select(task.orderId);}}}
      extra={<Space size={4}><Tag color={task.partsRequirement?.issuedAt?'green':'orange'}>{partsStatus(task.partsRequirement)}</Tag></Space>}>
      <div className="warehouse-identifier" aria-label="车牌号">
        <div><span>车牌号</span><strong>{task.plate||'未填写'}</strong></div>
        {task.plate?<CopyTextButton key={task.plate} text={task.plate} label={`复制车牌号 ${task.plate}`}/>:null}
      </div>
      <WarehouseDispatchNumber value={task.dispatchNo}/>
      <p>申请人：{task.partsRequirement?.ownerName||task.partsRequirement?.recordedName||task.technicianName||'未记录'}</p>
      <p className="warehouse-muted">申请时间：{displayTime(task.partsRequirement?.recordedAt)}</p>
    </Card>)}
    <Drawer destroyOnHidden title="配件申请详情" className="warehouse-drawer" open={Boolean(c.selectedId)} onClose={()=>{if(!c.busy){setIssuing(false);c.select();}}} size={600} styles={{wrapper:{maxWidth:'100vw'}}}
      footer={detail?<div className="warehouse-footer"><p>{actionable?(parts?.preparedAt?'实际交接时确认出库，系统记录领取人并自动开工。':'备料完成后将通知维修工领取。'):'当前申请无需处理，可查看历史记录。'}</p><Button block size="large" type={actionable?'primary':'default'} loading={c.busy} disabled={c.busy} onClick={()=>{if(actionable){if(parts?.preparedAt){setIssueVersion(detail.task.version);setIssuing(true);}else void c.act({action:'confirm-parts'});}else c.select();}}>{actionable?(parts?.preparedAt?isSupplementalParts(parts)?'确认补料出库':'确认出库':isSupplementalParts(parts)?'补料完成并通知领取':'备料完成并通知领取'):'关闭详情'}</Button></div>:null}>
      {available.length>1?<Select aria-label="选择维修工领料申请" style={{width:"100%",marginBottom:16}} value={owner||""} onChange={value=>{setSelectedOwner(value);setIssuing(false);}} options={available.map(t=>({value:t.partsRequirement?.ownerId||"",label:`${t.partsRequirement?.ownerName||"历史共同申请"} · ${partsStatus(t.partsRequirement)}`}))}/>:null}
      {c.error?<Alert type="error" showIcon title={c.error}/>:null}
      {!detail?<p role="status">正在加载申请…</p>:<WarehousePartsDetail key={`${detail.task.orderId}-${owner||"legacy"}`} detail={detail} controller={c} onOpenOrder={()=>setWorkOrderId(detail.task.orderId)}/>}
    </Drawer>
    <WarehouseWorkOrderDrawer orderId={workOrderId} onClose={()=>setWorkOrderId(undefined)}/>
    <Modal open={issuing&&Boolean(detail)} title={isSupplementalParts(parts)?'确认补料交接出库':'确认配件交接出库'} okText={isSupplementalParts(parts)?'确认补料出库':'确认出库'} confirmLoading={c.busy} okButtonProps={{disabled:!actionable||!parts?.preparedAt||issueVersion!==detail?.task.version}} cancelButtonProps={{disabled:c.busy}} closable={!c.busy} mask={{closable:false}} onCancel={()=>{if(!c.busy)setIssuing(false);}} onOk={async()=>{if(issueVersion!==detail?.task.version)return;if(await c.act({action:'issue-parts'}))setIssuing(false);}}>
      {detail?<><h3>{detail.task.plate}</h3><RepairContext task={detail.task}/></>:null}
      {issueVersion!==detail?.task.version?<Alert type="warning" showIcon title="申请已更新，请取消后重新核对出库"/>:null}
      <p>领取人：{parts?.ownerName || detail?.task.technicianName || parts?.recordedName || '未记录'}</p>
      <p>请确认本次申请的配件已全部交接。出库后待开工任务将自动进入维修中，暂停任务保留暂停状态。</p>
      {c.error?<Alert type="error" title={c.error}/>:null}
    </Modal>
  </section>;
}
