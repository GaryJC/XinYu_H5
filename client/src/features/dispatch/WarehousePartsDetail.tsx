import { Card, Collapse, Descriptions, Empty, Table, Tag } from 'antd';
import type { DispatchDetail, PartsRequirement } from '../../../../shared/types';
import { AuthenticatedImage } from '../../shared/ui/AuthenticatedImage';
import { actionLabels, displayTime } from './dispatchLabels';

function PartsTable({value}:{value?:PartsRequirement}) {
  if(!value) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本轮尚未登记配件"/>;
  if(value.mode==='none') return <p className="warehouse-muted">本次维修无需配件</p>;
  if(value.mode==='photo') return <div className="repair-photo-grid">{value.photoIds.map(id=><AuthenticatedImage key={id} fileId={id} alt="手写配件清单" width="100%" height={160}/>)}</div>;
  return <Table size="small" bordered pagination={false} tableLayout="fixed" rowKey="key" dataSource={value.items.map((item,key)=>({...item,key}))} columns={[
    {title:'配件名称',dataIndex:'name',render:(name:string)=><span className="warehouse-part-name">{name}</span>},
    {title:'数量',dataIndex:'quantity',width:76,align:'right',render:(quantity:number)=><strong>{quantity}</strong>},
    {title:'单位',dataIndex:'unit',width:64,align:'center'}
  ]}/>;
}

export function WarehousePartsDetail({detail}:{detail:DispatchDetail}) {
  const {task}=detail, parts=task.partsRequirement;
  const events=detail.events.filter(e=>['accept','record-parts','confirm-parts'].includes(e.action));
  return <div className="warehouse-detail">
    <section className="warehouse-order" aria-label="申请工单信息">
      <div className="warehouse-order-heading"><h2>{task.plate}</h2><Tag color={parts?.confirmedAt?'green':parts && parts.mode!=='none'?'gold':'default'}>{parts?.confirmedAt?'已确认':parts?.mode==='none'?'无需配件':parts?'待仓管确认':'历史申请'}</Tag></div>
      <div className="warehouse-order-ref">派工号 {task.dispatchNo || task.orderId}<span>{task.repairRound?`返工第 ${task.repairRound} 轮`:'首次维修'}</span></div>
      <Descriptions size="small" column={1} colon={false} items={[
        {key:'customer',label:'托修单位',children:task.customerName || '未填写'},
        {key:'model',label:'车型',children:task.vehicleModel || '未填写'},
        {key:'technician',label:'主修人',children:task.technicianName || '未记录'}
      ]}/>
    </section>
    <Card className="warehouse-parts-card" size="small" title="所需配件" extra={parts?.mode==='list'?<span className="warehouse-muted">共 {parts.items.length} 项</span>:null}>
      <PartsTable value={parts}/>
      {parts?<div className="warehouse-audit-meta"><span>申请人：{parts.recordedName || '未记录'}</span><time>{displayTime(parts.recordedAt)}</time></div>:null}
      {parts?.confirmedAt?<div className="warehouse-confirmed"><strong>仓管已确认 · {parts.confirmedName}</strong><time>{displayTime(parts.confirmedAt)}</time></div>:null}
    </Card>
    <Collapse key={task.orderId} className="warehouse-history" items={[{key:'history',label:'申请与确认记录',extra:<span className="warehouse-muted">{events.length} 条</span>,children:
      <div className="warehouse-events">{events.map(event=><article key={event.id} className="warehouse-event">
        <div className="warehouse-event-heading"><strong>{actionLabels[event.action as keyof typeof actionLabels]}</strong><span>{event.detail.repairRound?`返工第 ${event.detail.repairRound} 轮`:'首次维修'}</span></div>
        <div className="warehouse-event-meta"><span>{event.actorName}</span><time>{displayTime(event.at)}</time></div>
        <PartsTable value={event.detail.partsRequirement}/>
      </article>)}{!events.length?<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无记录"/>:null}</div>
    }]}/>
  </div>;
}
