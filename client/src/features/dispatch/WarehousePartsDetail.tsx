import { ActionHistory } from "../../shared/ui/ActionHistory";
import {VehicleNameplatePhotos} from './VehicleNameplatePhotos';
import {PartsReferencePhotos} from './PartsReferencePhotos';
import {partsHistoryEvents} from './partsHistory';
import {partsController,warehouseRequests} from './individualRepair';
import {WarehouseVehicleInfo} from './WarehouseVehicleInfo';
import {RepairContext} from './RepairContext';
import {WarehouseRepairItems} from './WarehouseRepairItems';
import { WarehousePartsEditor } from './WarehousePartsEditor';
import { useState } from 'react';
import type { DispatchController } from './useDispatchController';
import { WarehouseStockSearch } from './WarehouseStockSearch';
import { Button, Card, Collapse, Empty, Table, Tag } from 'antd';
import type { DispatchDetail, PartsRequirement } from '../../../../shared/types';
import { AuthenticatedImage } from '../../shared/ui/AuthenticatedImage';
import { canProcessParts, isSupplementalParts, partsStatus } from './partsProgress';
import { dispatchEventLabel, displayTime } from './dispatchLabels';

function PartsTable({value}:{value?:PartsRequirement}) {
  return <><PartsContent value={value}/><PartsReferencePhotos ids={value?.referencePhotoIds}/></>;
}

function PartsContent({value}:{value?:PartsRequirement}) {
  if(!value) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本轮尚未登记配件"/>;
  if(value.mode==='none') return <p className="warehouse-muted">本次维修无需配件</p>;
  if(value.mode==='photo') return <div className="repair-photo-grid">{value.photoIds.map(id=><AuthenticatedImage key={id} fileId={id} alt="手写配件清单" width="100%" height={160}/>)}</div>;
  return <><Table size="small" bordered pagination={false} tableLayout="fixed" rowKey="key" dataSource={value.items.map((item,key)=>({...item,key}))} columns={[
    {title:'配件名称',dataIndex:'name',render:(name:string)=><span className="warehouse-part-name">{name}</span>},
    {title:'数量',dataIndex:'quantity',width:76,align:'right',render:(quantity:number)=><strong>{quantity}</strong>},
    {title:'单位',dataIndex:'unit',width:54,align:'center'},
    {title:'领料 / 进度',render:(_,item)=><span>{item.issuedAt||item.preparedAt?item.recipientName:value.issuedAt?'历史未逐项记录':value.ownerName||value.applicantName||value.recordedName||'待确认'}<br/><Tag color={item.issuedAt||item.preparedAt||value.issuedAt||value.preparedAt?'green':'orange'}>{item.issuedAt||value.issuedAt?'历史已出库':item.preparedAt||value.preparedAt?'已备齐':'待备料'}</Tag>{item.preparedAt?<small>{displayTime(item.preparedAt)} · {item.preparedName}</small>:item.issuedAt?<small>{displayTime(item.issuedAt)} · {item.issuedName}</small>:null}</span>}
  ]}/>{value.sourcePhotoIds?.length?<Collapse items={[{key:'source',label:'原手写清单照片',children:<div className="repair-photo-grid">{value.sourcePhotoIds.map(id=><AuthenticatedImage key={id} fileId={id} alt="原手写配件清单" width="100%" height={160}/>)}</div>}]}/>:null}</>;
}

function WarehousePartsApplication({detail,controller}:{detail:DispatchDetail;controller?:DispatchController}) {
  const [editing,setEditing]=useState(false);
  const {task}=detail,parts=task.partsRequirement;
  const canEdit=Boolean(controller&&!controller.busy&&!task.needsReview&&task.acceptedAt&&['待开工','维修中','暂停','回审'].includes(task.stage)&&!parts?.issuedAt&&!parts?.preparedAt&&!parts?.items.some(i=>i.issuedAt||i.preparedAt));
  return <>
    <Card className="warehouse-parts-card" size="small" title={parts?.ownerName||'配件申请'} extra={canEdit?<Button size="small" onClick={()=>setEditing(true)}>新增／编辑配件</Button>:null}>
      <p>申请人：{parts?.ownerName||parts?.applicantName||parts?.recordedName||"未记录"}{parts?.ownerId?` · 负责项目：${task.items.filter(i=>i.responsibleId===parts.ownerId).map(i=>i.name).join("、")||"暂无当前项目"}`:""}</p>
      <PartsTable value={parts}/>
      {parts?<div className="warehouse-audit-meta"><span>登记人：{parts.recordedName || '未记录'}</span><time>{displayTime(parts.recordedAt)}</time></div>:null}
      {parts?.preparedAt?<div className="warehouse-confirmed"><strong>{isSupplementalParts(parts)?'补料完成':'备料完成'} · {parts.preparedName}</strong><time>{displayTime(parts.preparedAt)}</time></div>:null}
      {parts?.items.some(i=>i.issuedAt||i.preparedAt)&&!parts.issuedAt&&!parts.preparedAt?<p>已备齐 {parts.items.filter(i=>i.issuedAt||i.preparedAt).length} / {parts.items.length} 项，其余继续待备料。</p>:null}
      {parts?.issuedAt?<div className="warehouse-confirmed"><strong>{isSupplementalParts(parts)?'补料出库':'已出库'} · {parts.issuedName} · 领取人：{parts.recipientName}</strong><time>{displayTime(parts.issuedAt)}</time></div>:null}
      {parts?.confirmedAt?<p className="warehouse-muted">历史申请确认：{parts.confirmedName} · {displayTime(parts.confirmedAt)}（未记录出库）</p>:null}
    </Card>
    {editing&&controller?<WarehousePartsEditor key={`editor-${task.orderId}-${parts?.ownerId||'legacy'}`} controller={controller} onClose={()=>setEditing(false)}/>:null}
  </>;
}

export function WarehousePartsDetail({detail,controller,onOpenOrder}:{detail:DispatchDetail;controller?:DispatchController;onOpenOrder?:()=>void}) {
  const {task}=detail, parts=task.partsRequirement;
  const events=partsHistoryEvents(detail.events).filter(e=>['accept','record-parts','edit-parts','confirm-parts','issue-parts'].includes(e.action)&&e.detail.partsRequirement);
  const issuedEvents=events.filter(event=>event.detail.partsRequirement?.ownerId===parts?.ownerId&&((event.action==='issue-parts'&&event.detail.partsRequirement?.issuedAt)||(event.action==='confirm-parts'&&event.detail.partsRequirement?.preparedAt&&!events.some(other=>other.action==='issue-parts'&&other.detail.partsRequirement?.issuedAt&&(other.detail.partsRequirement.batch??1)===(event.detail.partsRequirement?.batch??1)&&(other.detail.repairRound??0)===(event.detail.repairRound??0))))&&(event.detail.repairRound??0)===(task.repairRound??0)&&(event.detail.partsRequirement.batch??1)<(parts?.batch??1)).slice().reverse();
  return <div className="warehouse-detail">
    <section className="warehouse-order" aria-label="申请工单信息">
      <div className="warehouse-order-heading"><h2>车辆信息</h2><Tag color={parts?.issuedAt||parts?.preparedAt?'green':parts && parts.mode!=='none'?'gold':'default'}>{partsStatus(parts)}</Tag><RepairContext task={task}/></div>
      <WarehouseVehicleInfo task={task}/>
      <VehicleNameplatePhotos currentId={task.vehicleNameplateFileId} files={detail.files}/>
      {onOpenOrder?<Button className="warehouse-open-order" block onClick={onOpenOrder}>查看委托单</Button>:null}
    </section>
    <WarehouseRepairItems task={task} disabled={controller?.busy} onRefresh={controller?()=>Promise.all([controller.refresh(),controller.refreshDetail()]):undefined}/>
    <section className="warehouse-parts-applications" aria-label="所需配件"><h3>所需配件</h3>
      {warehouseRequests([controller?.detail?.task||task]).map(application=>{
        const scoped=controller?partsController(controller,application.partsRequirement?.ownerId):undefined;
        return <WarehousePartsApplication key={application.partsRequirement?.ownerId||'legacy'} detail={{...detail,task:application}} controller={scoped}/>;
      })}
    </section>
    {isSupplementalParts(parts)?<Card className="warehouse-issued-parts" size="small" title="已完成配件申请">
      <p className="warehouse-muted">以下为本轮之前已完成的配件申请，仅供查看。</p>
      {issuedEvents.map(event=><section className="warehouse-issued-batch" key={event.id} aria-label={`已完成第 ${event.detail.partsRequirement?.batch??1} 批配件`}>
        <h4>第 {event.detail.partsRequirement?.batch??1} 批 · {dispatchEventLabel(event)}</h4>
        <PartsTable value={event.detail.partsRequirement}/>
        <div className="warehouse-audit-meta"><span>经办人：{event.detail.partsRequirement?.issuedName||event.actorName}</span><time>{displayTime(event.detail.partsRequirement?.issuedAt||event.at)}</time></div>
        <p className="warehouse-muted">领取人：{event.detail.partsRequirement?.recipientName||'未记录'}</p>
      </section>)}
      {!issuedEvents.length?<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可展示的历史配件明细"/>:null}
    </Card>:null}
    {canProcessParts(task)&&partsStatus(parts)==='待备料'?<WarehouseStockSearch key={`stock-${task.orderId}`} orderId={task.orderId} requirement={parts}/>:null}
    <Collapse key={task.orderId} className="warehouse-history" items={[{key:'history',label:'申请与备料记录',extra:<span className="warehouse-muted">{events.length} 条</span>,children:
      <ActionHistory items={events.map(event=>({key:event.id,title:dispatchEventLabel(event),actor:event.actorName,time:displayTime(event.at),detail:<><p>{event.detail.repairRound?`返工第 ${event.detail.repairRound} 轮`:'首次维修'}</p>
        <PartsTable value={(event.detail.partsIssue||event.detail.partsPreparation)&&event.detail.partsRequirement?{...event.detail.partsRequirement,items:(event.detail.partsIssue||event.detail.partsPreparation)!.map(row=>event.detail.partsRequirement!.items[row.index]).filter(Boolean)}:event.detail.partsRequirement}/></>}))}/>

    }]}/>
  </div>;
}
