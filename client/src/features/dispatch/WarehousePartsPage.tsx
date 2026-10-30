import { ListPagination } from '../../shared/ui/ListPagination';
import { Grid } from 'antd';
import { LoadingState } from "../../shared/ui/LoadingState";
import {PartsPreparationDialog} from './PartsPreparationDialog';
import {CopyTextButton} from '../../shared/ui/CopyTextButton';
import {displayTime} from './dispatchLabels';
import {type WarehouseRequestSort} from './warehouseRequestSort';
import {partsController,warehouseRequests} from './individualRepair';
import {WarehouseDispatchNumber} from './WarehouseDispatchNumber';
import {WarehouseWorkOrderDrawer} from './WarehouseWorkOrderDrawer';
import { useState } from 'react';
import { Alert, Button, Card, Drawer, Empty, Input, Segmented, Select, Space, Tag } from 'antd';
import type { DispatchController } from './useDispatchController';
import { WarehousePartsDetail } from './WarehousePartsDetail';
import { canProcessParts, partsStatus } from './partsProgress';
import './warehouse.css';

export function WarehousePartsPage({controller:source}:{controller:DispatchController}) {
  const [issuing,setIssuing]=useState(false);
  const mobile=!Grid.useBreakpoint().md;
  const status=source.filters.partsStatus||'待备料';
  const setStatus=(partsStatus:string)=>source.setFilters(filters=>({...filters,partsStatus}));
  const [workOrderId,setWorkOrderId]=useState<string>();
  const sortOrder=(source.filters.partsSort||'newest') as WarehouseRequestSort;
  const setSortOrder=(partsSort:WarehouseRequestSort)=>source.setFilters(filters=>({...filters,partsSort}));
  const [selectedOwner,setSelectedOwner]=useState<string>();
  const available=source.detail?warehouseRequests([source.detail.task]):[];
  const owner=selectedOwner!==undefined&&available.some(t=>(t.partsRequirement?.ownerId||'')===selectedOwner)?selectedOwner:available.find(canProcessParts)?.partsRequirement?.ownerId||available[0]?.partsRequirement?.ownerId;
  const c=partsController(source,owner);
  const tasks=source.tasks;
  const counts=source.list.counts||{};
  const pendingCount=(counts['待备料']||0)+(counts['部分备齐']||0);
  const detail=c.detail;
  const actionable=available.some(canProcessParts);
  const allPrepared=available.length>0&&available.every(t=>t.partsRequirement?.mode==='none'||t.partsRequirement?.preparedAt||t.partsRequirement?.issuedAt);
  const pendingItems=available.filter(canProcessParts).reduce((count,t)=>count+(t.partsRequirement?.mode==='list'?t.partsRequirement.items.filter(i=>!i.preparedAt&&!i.issuedAt).length:0),0);
  const photoRequests=available.filter(t=>canProcessParts(t)&&t.partsRequirement?.mode==='photo').length;
  return <section className="dispatch-page" aria-label="配件申请">
    <div className="dispatch-heading"><div><h2>配件申请</h2><p>待处理 {pendingCount} 单 · 按配件确认备料，通知对应维修工领取。</p></div><Button loading={c.loading} onClick={()=>{void c.refresh();void c.refreshDetail();}}>刷新</Button></div>
    {c.error?<Alert type="error" showIcon title={c.error}/>:null}
    <div className="warehouse-filters">
      <Input.Search aria-label="搜索配件申请" placeholder="车牌 / 委托单号 / 派工号" allowClear onSearch={search=>c.setFilters(filters=>({...filters,search}))}/>
      <label className="warehouse-sort">排序
        <Select aria-label="配件申请排序" value={sortOrder} onChange={setSortOrder} options={[
          {value:'newest',label:'申请时间：最新在前'},
          {value:'oldest',label:'申请时间：最早在前'}
        ]}/>
      </label>
      <Segmented className="repair-task-tabs" block aria-label="配件申请状态" value={status} onChange={setStatus} options={['待备料','部分备齐','备料完成'].map(value=>({value,label:value})).map(option=>({...option,className:status===option.value?'repair-tab-active':undefined,label:`${option.label}（${counts[option.value]||0}）`}))}/>
    </div>
    {c.loading && <LoadingState label="正在加载配件申请…" />}
    {!c.loading && !tasks.length?<Empty description="暂无配件申请"/>:null}
    {tasks.map(task=><Card key={`${task.orderId}-${task.partsRequirement?.ownerId||'legacy'}`} className="warehouse-request-card" size="small" title="配件申请" role="button" tabIndex={0} aria-label={`查看配件申请 ${task.plate||task.orderId} ${task.dispatchNo||task.orderId}`}
      onClick={event=>{if(event.target instanceof Element&&event.target.closest('button'))return;setSelectedOwner(task.partsRequirement?.ownerId||'');c.select(task.orderId);}}
      onKeyDown={event=>{if(event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();setSelectedOwner(task.partsRequirement?.ownerId||'');c.select(task.orderId);}}}
      extra={<Space size={4}><Tag color={task.partsRequirement?.issuedAt||task.partsRequirement?.preparedAt?'green':'orange'}>{partsStatus(task.partsRequirement)}</Tag></Space>}>
      <div className="warehouse-identifier" aria-label="车牌号">
        <div><span>车牌号</span><strong>{task.plate||'未填写'}</strong></div>
        {task.plate?<CopyTextButton key={task.plate} text={task.plate} label={`复制车牌号 ${task.plate}`}/>:null}
      </div>
      <WarehouseDispatchNumber value={task.dispatchNo}/>
      <p>申请人：{task.partsRequirement?.ownerName||task.partsRequirement?.applicantName||task.partsRequirement?.recordedName||task.technicianName||'未记录'}</p>
      <p className="warehouse-muted">申请时间：{displayTime(task.partsRequirement?.recordedAt)}</p>
    </Card>)}
    <ListPagination mobile={mobile} page={c.list.page} total={c.list.total} loaded={tasks.length} loading={c.loading} onPage={c.list.setPage} onMore={c.list.loadMore}/>
    <Drawer destroyOnHidden title="配件申请详情" className="warehouse-drawer" open={Boolean(c.selectedId)} onClose={()=>{if(!c.busy){setIssuing(false);c.select();}}} size={600} styles={{wrapper:{maxWidth:'100vw'}}}
      footer={detail?<div className="warehouse-footer"><p>{actionable?`${available.length} ${available.every(t=>t.partsRequirement?.ownerId)?'人':'份'}申请 · ${pendingItems} 项待备料${photoRequests?` · ${photoRequests} 份照片清单待备料`:''}`:allPrepared?'备料已完成':'当前申请暂不可处理'}</p>{actionable?<Button block size="large" type="primary" disabled={c.busy||(!pendingItems&&!photoRequests)} onClick={()=>setIssuing(true)}>确认备料</Button>:<Button block onClick={()=>c.select()}>关闭详情</Button>}</div>:null}>
      {c.error?<Alert type="error" showIcon title={c.error}/>:null}
      {!detail?(c.detailLoading?<LoadingState label="正在加载申请详情…" />:null):<WarehousePartsDetail key={`${detail.task.orderId}-${owner||"legacy"}`} detail={detail} controller={source} onOpenOrder={()=>setWorkOrderId(detail.task.orderId)}/>}
    </Drawer>
    <WarehouseWorkOrderDrawer orderId={workOrderId} onClose={()=>setWorkOrderId(undefined)}/>
    {issuing&&detail?<PartsPreparationDialog key={detail.task.orderId} controller={source} onClose={()=>{if(!c.busy)setIssuing(false);}}/>:null}
  </section>;
}
