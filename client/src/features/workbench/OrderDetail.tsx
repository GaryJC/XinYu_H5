import { RepairStatusTag } from "../dispatch/RepairStatusTag";
import { ActionHistory } from "../../shared/ui/ActionHistory";
import './workbench.css';
import './order-detail.css';
import { CarFront, ClipboardList, Users, Wallet, Wrench, FileText, ChevronRight } from 'lucide-react';
import { CopyTextButton } from "../../shared/ui/CopyTextButton";
import { type ReactNode } from 'react';
import { Button, Collapse, Descriptions, Empty, Table } from 'antd';
import type { WorkOrder, UserProfile } from '../../../../shared/types';
import { CustomerSignatureSection } from '../signature/CustomerSignatureSection';
import { CustomerVehicleUpdateTag } from '../customer-vehicle-update/CustomerVehicleUpdateTag';
import { SubmittedOrderPhotos } from '../work-order-photos/SubmittedOrderPhotos';
import { workOrderDisplayStatus } from '../work-orders/domain/workOrderDomain';
import { LegacySyncStatusChip, StatusChip } from '../../shared/ui/Status';
export function OrderDetail({ order, isMobile, user, onUpdated, onOpenRepairs }: { order: WorkOrder; isMobile: boolean; user?: UserProfile; onUpdated:(order:WorkOrder)=>void; onOpenRepairs?:()=>void }) {
  if (order.paperOrder?.mode === "pending") return <div className="order-detail-content">
    <OrderIdentity order={order} />
    <section className="workbench-detail-group" aria-label="纸质委托单信息"><h3><FileText size={18} aria-hidden="true" />纸质委托单信息</h3>
    <Descriptions bordered size="small" column={isMobile ? 1 : 3} items={[
      {key:"id",label:"委托单号",children:order.id},
      {key:"advisor",label:"服务顾问",children:order.advisor},
      {key:"created",label:"创建时间",children:order.createdAt}
    ]}/></section>
    <SubmittedOrderPhotos order={order} user={user} onUpdated={onUpdated} section="other"/>
    <CustomerSignatureSection order={order} user={user} onUpdated={onUpdated}/>
  </div>;
  const signatures = Object.entries(order.signatures).map(([type, name]) => `${type}: ${name}`).join("；") || "-";
  const descriptions = [
    { key: "id", label: "委托单号", children: order.id, span: 2 },
    { key: "advisor", label: "服务顾问", children: order.advisor || "-" },
    { key: "dispatch", label: "派工号", children: <DispatchNumber value={order.dispatchNo} /> },
    { key: "arrival", label: "进厂日期", children: order.arrivalDate || "-" },
    { key: "delivery", label: "预计交车", children: order.estimatedDeliveryAt || "-" },
    { key: "updated", label: "更新时间", children: order.updatedAt || "-" },
    { key: "shop", label: "门店地址", children: order.shop.address || "-", span: 2 },
    { key: "shopPhone", label: "门店电话", children: order.shop.phone || "-" },
    { key: "platform", label: "平台工单号", children: order.platformOrderNo || "-", span: 2 },
    { key: "vin", label: "VIN/底盘号", children: order.vehicle.vin ? <span className="detail-copy-value">{order.vehicle.vin}<CopyTextButton text={order.vehicle.vin} label="复制 VIN/底盘号" iconOnly /></span> : "-", span: 2 },
    { key: "mileage", label: "进厂里程", children: order.vehicle.mileage ? `${order.vehicle.mileage} km` : "-" },
    { key: "purchase", label: "购车日期", children: order.vehicle.purchaseDate || "-" },
    { key: "customer", label: "车主名称/所属单位", children: order.customer.name || "-", span: 2 },
    { key: "contact", label: "联系人", children: order.customer.contact || "-" },
    { key: "phone", label: "联系电话", children: order.customer.phone || "-" },
    { key: "address", label: "车辆地址", children: order.customer.address || "-", span: 2 },
    { key: "fault", label: "故障描述", children: order.faultDescription || "-", span: 2 },
    { key: "belongings", label: "随车物品", children: order.inspection.belongings.join("、") || "-" },
    { key: "exterior", label: "外观状况", children: order.inspection.exteriorIssues.join("、") || "-" },
    { key: "fuel", label: "燃油存量", children: order.inspection.fuelLevel },
    { key: "oldParts", label: "旧件处置", children: order.oldPartsHandling, span: 2 },
    { key: "feeNote", label: "费用备注", children: order.feeNote || "-", span: 2 },
    { key: "signatures", label: "签字记录", children: signatures, span: 2 }
  ];

  return (
    <div className="order-detail-content">
      <OrderIdentity order={order} />
      <div className="order-detail-grid">
      {[
        { title: '委托与进度', icon: ClipboardList, keys: ['dispatch','advisor','arrival','delivery','updated','shopPhone','shop','id','platform'] },
        { title: '车辆与客户', icon: Users, keys: ['vin','mileage','purchase','customer','contact','phone','address'] },
        { title: '故障与检查', icon: CarFront, keys: ['fault','belongings','exterior','fuel'] }
      ].map(group => <section className="workbench-detail-group" key={group.title} aria-label={group.title}>
        <h3><group.icon size={18} aria-hidden="true" />{group.title}</h3>
        <Descriptions className="archive-descriptions" layout="vertical" size="small" column={2} items={group.keys.flatMap(key => descriptions.filter(item => item.key === key))} />
      </section>)}
      </div>
      <OrderRepairRecords order={order} isMobile={isMobile} onOpen={onOpenRepairs}/>
      <section className="workbench-detail-group" aria-label="费用与签字">
        <h3><Wallet size={18} aria-hidden="true" />费用与签字</h3>
        <Descriptions className="archive-descriptions" layout="vertical" size="small" column={2} items={descriptions.filter(item => ['oldParts', 'feeNote', 'signatures'].includes(item.key))} />
      </section>
      <SubmittedOrderPhotos order={order} user={user} onUpdated={onUpdated}/>
      <CustomerSignatureSection order={order} user={user} onUpdated={onUpdated}/>
      {isMobile ? <MobileOrderRecords order={order} /> : <DesktopOrderRecords order={order} />}
    </div>
  );
}

function DispatchNumber({ value }: { value?: string }) {
  return value ? <div className="detail-dispatch-number"><strong>{value}</strong><CopyTextButton text={value} label="复制派工号" iconOnly /></div> : <span>暂无派工号</span>;
}

function OrderIdentity({ order }: { order: WorkOrder }) {
  return <section className="workbench-order-summary detail-identity" aria-label="委托单摘要">
    <div className="detail-identity-heading">
      <span className="workbench-order-icon"><CarFront size={28} aria-hidden="true" /></span>
      <div className="detail-identity-vehicle"><span className="workbench-detail-eyebrow">{order.paperOrder ? '纸质委托单' : '机动车修理委托单'}</span><h2>{order.vehicle.plate || '未登记车牌'}</h2><p>{order.vehicle.model || '车型待补充'}</p></div>
      <div className="workbench-order-status"><StatusChip status={workOrderDisplayStatus(order)} /><OrderLegacySyncStatus order={order} /></div>
    </div>
    <div className="detail-identity-meta">
      <div><span>车主 / 所属单位</span><strong>{order.customer.name || '未登记车主'}</strong></div>
      <div><span>服务顾问</span><strong>{order.advisor || '未分配'}</strong></div>
      <div><span>派工单号</span><DispatchNumber value={order.dispatchNo} /></div>
    </div>
  </section>;
}

export function OrderLegacySyncStatus({ order }: { order: WorkOrder }) {
  if (order.status === "草稿") return null;
  return <><LegacySyncStatusChip status={order.legacySyncStatus} /><CustomerVehicleUpdateTag order={order} /></>;
}

function OrderRepairRecords({order,isMobile,onOpen}:{order:WorkOrder;isMobile:boolean;onOpen?:()=>void}) {
  if (isMobile) return <section className="workbench-detail-group detail-repairs" aria-label="维修项目">
    <h3><Wrench size={18} aria-hidden="true" />{onOpen ? <Button type="link" className="detail-repair-link" onClick={onOpen} aria-label="查看派工单维修项目">维修项目<ChevronRight size={16} aria-hidden="true" /></Button> : "维修项目"}<span className="detail-section-count">{order.repairItems.length} 项</span></h3>
    {order.repairItems.length ? <div className="detail-repair-list">{order.repairItems.map((item, index) => <article className="detail-repair-card" key={item.id}>
      <div className="detail-repair-heading"><span className="detail-repair-index">{String(index + 1).padStart(2, '0')}</span><h4>{item.name || '未填写项目'}</h4><RepairStatusTag status={item.status || '未记录'} />{onOpen && <Button type="text" className="detail-repair-open" aria-label={`在派工单中查看维修项目：${item.name || '未填写项目'}`} title="查看维修项目" icon={<ChevronRight size={20} aria-hidden="true" />} onClick={onOpen} />}</div>
      <dl><div><dt>工费</dt><dd>¥{item.laborFee}</dd></div><div><dt>主修人</dt><dd>{item.owner || '未分配'}</dd></div><div><dt>开工</dt><dd>{item.startAt || '未记录'}</dd></div><div><dt>完工</dt><dd>{item.finishAt || '未记录'}</dd></div><div><dt>检查人</dt><dd>{item.inspector || '未记录'}</dd></div></dl>
    </article>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无维修项目" />}
  </section>;
  return <DetailTable title="维修项目" onOpen={onOpen} rowKey="id" dataSource={order.repairItems} columns={[
      { title: "项目", dataIndex: "name" }, { title: "工费", dataIndex: "laborFee", render: (value: number) => `¥${value}` },
      { title: "主修人", dataIndex: "owner" }, { title: "状态", dataIndex: "status", render: (value: string) => <RepairStatusTag status={value || "未记录"} /> }, { title: "开工", dataIndex: "startAt" },
      { title: "完工", dataIndex: "finishAt" }, { title: "检查人", dataIndex: "inspector" }
    ]} />;
}

function MobileOrderRecords({ order }: { order: WorkOrder }) {
  return <Collapse className="archive-mobile-collapse" items={[
    { key: "ocr", label: `OCR 记录（${order.ocrRecords.length}）`, children: <OrderEventHistory order={order} kind="ocr" /> },
    { key: "sync", label: `平台同步（${order.platformSyncRecords.length}）`, children: <OrderEventHistory order={order} kind="sync" /> },
    { key: "outbound", label: `出库单（${order.outboundOrders.length}）`, children: <MobileRecords rows={order.outboundOrders.map((item) => [["出库单号", item.id], ["派工号", item.dispatchNo], ["技师", item.technician], ["状态", item.status], ["物料项目数", String(item.items.length)]])} /> },
    { key: "settlement", label: `结算记录（${order.settlementStatements.length}）`, children: <OrderEventHistory order={order} kind="settlement" /> },
    { key: "audit", label: `操作留痕（${order.auditLog.length}）`, children: <OrderAuditHistory order={order} /> }
  ]} />;
}

function MobileRecords({ rows }: { rows: Array<Array<[string, ReactNode]>> }) {
  if (!rows.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无记录" />;
  return <div className="archive-mobile-records">{rows.map((fields, index) => (
    <dl className="archive-mobile-record" key={index}>
      {fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  ))}</div>;
}

function DesktopOrderRecords({ order }: { order: WorkOrder }) {
  return <>
    <OrderEventHistory order={order} kind="ocr" title="OCR 记录" />
    <OrderEventHistory order={order} kind="sync" title="平台同步记录" />
    <DetailTable title="出库单" rowKey="id" dataSource={order.outboundOrders} columns={[
      { title: "出库单号", dataIndex: "id" }, { title: "派工号", dataIndex: "dispatchNo" }, { title: "技师", dataIndex: "technician" },
      { title: "状态", dataIndex: "status", render: (value: string) => <RepairStatusTag status={value || "未记录"} /> }, { title: "物料项目数", render: (_: unknown, item: WorkOrder["outboundOrders"][number]) => item.items.length }
    ]} />
    <OrderEventHistory order={order} kind="settlement" title="结算记录" />
    <OrderAuditHistory order={order} title="操作留痕" />
  </>;
}

function DetailTable<T extends object>({ title, rowKey, dataSource, columns, onOpen }: {
  title: string; onOpen?:()=>void; rowKey: string | ((item: T) => string); dataSource: T[]; columns: Parameters<typeof Table<T>>[0]["columns"];
}) {
  return <section className="archive-detail-section"><h3>{onOpen ? <Button type="link" className="detail-repair-link" onClick={onOpen} aria-label="查看派工单维修项目">{title}<ChevronRight size={16} aria-hidden="true" /></Button> : title}</h3><Table<T> onRow={onOpen ? () => ({onClick:onOpen,tabIndex:0,role:"button",'aria-label':"查看派工单维修项目",onKeyDown:event=>{if(event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();onOpen();}}}) : undefined} size="small" rowKey={rowKey} dataSource={dataSource} columns={columns} pagination={false} scroll={{ x: "max-content" }} locale={{ emptyText: "暂无记录" }} /></section>;
}

function OrderAuditHistory({order,title}:{order:WorkOrder;title?:string}) {
  return <ActionHistory title={title} items={order.auditLog.map((item,index)=>({key:index,title:item.action,actor:item.actor,time:item.at}))}/>;
}

function OrderEventHistory({order,kind,title}:{order:WorkOrder;kind:'ocr'|'sync'|'settlement';title?:string}) {
  if(kind==='ocr')return <ActionHistory title={title} items={order.ocrRecords.map(item=>({key:item.id,title:`${item.source} · ${item.status}`,time:item.createdAt,detail:<><p>置信度：{item.confidence}</p><p>确认时间：{item.confirmedAt||'-'}</p></>}))}/>;
  if(kind==='sync')return <ActionHistory title={title} items={order.platformSyncRecords.map(item=>({key:item.id,title:`平台同步 · ${item.status}`,time:item.syncedAt,detail:<><p>平台工单号：{item.platformOrderNo}</p><p>{item.message}</p></>}))}/>;
  return <ActionHistory title={title} items={order.settlementStatements.map(item=>({key:item.id,title:`结算 · ¥${item.amount}`,time:item.syncedAt,detail:<><p>派工号：{item.dispatchNo}</p><p>来源：{item.source} · 匹配状态：{item.matchStatus}</p></>}))}/>;
}
