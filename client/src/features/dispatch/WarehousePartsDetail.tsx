import { WarehouseDispatchNumber } from './WarehouseDispatchNumber';
import { WarehousePartsEditor } from './WarehousePartsEditor';
import { useState } from 'react';
import type { DispatchController } from './useDispatchController';
import { WarehouseStockSearch } from './WarehouseStockSearch';
import { Button, Card, Collapse, Descriptions, Empty, Table, Tag } from 'antd';
import type { DispatchDetail, PartsRequirement } from '../../../../shared/types';
import { AuthenticatedImage } from '../../shared/ui/AuthenticatedImage';
import { canProcessParts, isSupplementalParts, partsStatus } from './partsProgress';
import { dispatchEventLabel, displayTime } from './dispatchLabels';

function PartsTable({value}:{value?:PartsRequirement}) {
  if(!value) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本轮尚未登记配件"/>;
  if(value.mode==='none') return <p className="warehouse-muted">本次维修无需配件</p>;
  if(value.mode==='photo') return <div className="repair-photo-grid">{value.photoIds.map(id=><AuthenticatedImage key={id} fileId={id} alt="手写配件清单" width="100%" height={160}/>)}</div>;
  return <><Table size="small" bordered pagination={false} tableLayout="fixed" rowKey="key" dataSource={value.items.map((item,key)=>({...item,key}))} columns={[
    {title:'配件名称',dataIndex:'name',render:(name:string)=><span className="warehouse-part-name">{name}</span>},
    {title:'数量',dataIndex:'quantity',width:76,align:'right',render:(quantity:number)=><strong>{quantity}</strong>},
    {title:'单位',dataIndex:'unit',width:64,align:'center'}
  ]}/>{value.sourcePhotoIds?.length?<Collapse items={[{key:'source',label:'原手写清单照片',children:<div className="repair-photo-grid">{value.sourcePhotoIds.map(id=><AuthenticatedImage key={id} fileId={id} alt="原手写配件清单" width="100%" height={160}/>)}</div>}]}/>:null}</>;
}

export function WarehousePartsDetail({detail,controller}:{detail:DispatchDetail;controller?:DispatchController}) {
  const [editing,setEditing]=useState(false);
  const {task}=detail, parts=task.partsRequirement;
  const events=detail.events.filter(e=>['accept','record-parts','edit-parts','confirm-parts','issue-parts'].includes(e.action));
  const issuedEvents=events.filter(event=>event.action==='issue-parts'&&event.detail.partsRequirement?.issuedAt&&(event.detail.repairRound??0)===(task.repairRound??0)&&(event.detail.partsRequirement.batch??1)<(parts?.batch??1)).slice().reverse();
  const canEdit=Boolean(controller&&!controller.busy&&!task.needsReview&&task.acceptedAt&&['待开工','维修中','暂停'].includes(task.stage)&&!parts?.issuedAt);
  return <div className="warehouse-detail">
    <section className="warehouse-order" aria-label="申请工单信息">
      <div className="warehouse-order-heading"><h2>{task.plate}</h2><Tag color={parts?.issuedAt?'green':parts && parts.mode!=='none'?'gold':'default'}>{partsStatus(parts)}</Tag>{isSupplementalParts(parts)?<Tag color="blue">补料</Tag>:null}</div>
      <WarehouseDispatchNumber value={task.dispatchNo}/>
      <Collapse className="warehouse-order-more" items={[{key:'details',label:'查看委托单其他详情',children:<Descriptions size="small" column={1} colon={false} items={[
        {key:'order',label:'委托单号',children:task.orderId},
        {key:'round',label:'维修轮次',children:task.repairRound?`返工第 ${task.repairRound} 轮`:'首次维修'},
        {key:'customer',label:'托修单位',children:task.customerName || '未填写'},
        {key:'model',label:'车型',children:task.vehicleModel || '未填写'},
        {key:'technician',label:'主修人',children:task.technicianName || '未记录'}
      ]}/>}]} />
    </section>
    <Card className="warehouse-parts-card" size="small" title={isSupplementalParts(parts)?'补料所需配件':'所需配件'} extra={canEdit?<Button size="small" onClick={()=>setEditing(true)}>新增／编辑配件</Button>:null}>
      <PartsTable value={parts}/>
      {parts?<div className="warehouse-audit-meta"><span>登记人：{parts.recordedName || '未记录'}</span><time>{displayTime(parts.recordedAt)}</time></div>:null}
      {parts?.preparedAt?<div className="warehouse-confirmed"><strong>{isSupplementalParts(parts)?'补料完成':'备料完成'} · {parts.preparedName}</strong><time>{displayTime(parts.preparedAt)}</time></div>:null}
      {parts?.issuedAt?<div className="warehouse-confirmed"><strong>{isSupplementalParts(parts)?'补料出库':'已出库'} · {parts.issuedName} · 领取人：{parts.recipientName}</strong><time>{displayTime(parts.issuedAt)}</time></div>:null}
      {parts?.confirmedAt?<p className="warehouse-muted">历史申请确认：{parts.confirmedName} · {displayTime(parts.confirmedAt)}（未记录出库）</p>:null}
    </Card>
    {isSupplementalParts(parts)?<Card className="warehouse-issued-parts" size="small" title="已出库配件">
      <p className="warehouse-muted">以下为本轮之前已交接的配件，已出库明细仅供查看。</p>
      {issuedEvents.map(event=><section className="warehouse-issued-batch" key={event.id} aria-label={`已出库第 ${event.detail.partsRequirement?.batch??1} 批配件`}>
        <h4>第 {event.detail.partsRequirement?.batch??1} 批 · {dispatchEventLabel(event)}</h4>
        <PartsTable value={event.detail.partsRequirement}/>
        <div className="warehouse-audit-meta"><span>出库人：{event.detail.partsRequirement?.issuedName||event.actorName}</span><time>{displayTime(event.detail.partsRequirement?.issuedAt||event.at)}</time></div>
        <p className="warehouse-muted">领取人：{event.detail.partsRequirement?.recipientName||'未记录'}</p>
      </section>)}
      {!issuedEvents.length?<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可展示的历史出库明细"/>:null}
    </Card>:null}
    {editing&&controller?<WarehousePartsEditor key={`editor-${task.orderId}`} controller={controller} onClose={()=>setEditing(false)}/>:null}
    {canProcessParts(task)&&partsStatus(parts)==='待备料'?<WarehouseStockSearch key={`stock-${task.orderId}`} orderId={task.orderId} requirement={parts}/>:null}
    <Collapse key={task.orderId} className="warehouse-history" items={[{key:'history',label:'申请、备料与出库记录',extra:<span className="warehouse-muted">{events.length} 条</span>,children:
      <div className="warehouse-events">{events.map(event=><article key={event.id} className="warehouse-event">
        <div className="warehouse-event-heading"><strong>{dispatchEventLabel(event)}</strong><span>{event.detail.repairRound?`返工第 ${event.detail.repairRound} 轮`:'首次维修'}</span></div>
        <div className="warehouse-event-meta"><span>{event.actorName}</span><time>{displayTime(event.at)}</time></div>
        <PartsTable value={event.detail.partsRequirement}/>
      </article>)}{!events.length?<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无记录"/>:null}</div>
    }]}/>
  </div>;
}
