import { ActionHistory } from "../../shared/ui/ActionHistory";
import './workbench.css';
import { CarFront, ClipboardList, Users, Wallet } from 'lucide-react';
import { type ReactNode } from 'react';
import { Collapse, Descriptions, Empty, Table, Tag } from 'antd';
import type { WorkOrder, UserProfile } from '../../../../shared/types';
import { CustomerSignatureSection } from '../signature/CustomerSignatureSection';
import { CustomerVehicleUpdateTag } from '../customer-vehicle-update/CustomerVehicleUpdateTag';
import { SubmittedOrderPhotos } from '../work-order-photos/SubmittedOrderPhotos';
import { workOrderDisplayStatus } from '../work-orders/domain/workOrderDomain';
import { LegacySyncStatusChip, StatusChip } from '../../shared/ui/Status';
export function OrderDetail({ order, isMobile, user, onUpdated }: { order: WorkOrder; isMobile: boolean; user?: UserProfile; onUpdated:(order:WorkOrder)=>void }) {
  if (order.paperOrder?.mode === "pending") return <>
    <Descriptions bordered size="small" column={isMobile ? 1 : 3} items={[
      {key:"id",label:"委托单号",children:order.id},
      {key:"advisor",label:"服务顾问",children:order.advisor},
      {key:"created",label:"创建时间",children:order.createdAt}
    ]}/>
    <SubmittedOrderPhotos order={order} user={user} onUpdated={onUpdated} section="other"/>
    <CustomerSignatureSection order={order} user={user} onUpdated={onUpdated}/>
  </>;
  const signatures = Object.entries(order.signatures).map(([type, name]) => `${type}: ${name}`).join("；") || "-";
  const descriptions = [
    { key: "id", label: "委托单号", children: order.id },
    { key: "status", label: "状态", children: <StatusChip status={workOrderDisplayStatus(order)} /> },
    { key: "legacySyncStatus", label: "润丰同步", children: <OrderLegacySyncStatus order={order} /> },
    { key: "advisor", label: "服务顾问", children: order.advisor || "-" },
    { key: "dispatch", label: "派工号", children: order.dispatchNo || "-" },
    { key: "arrival", label: "进厂日期", children: order.arrivalDate || "-" },
    { key: "delivery", label: "预计交车", children: order.estimatedDeliveryAt || "-" },
    { key: "updated", label: "更新时间", children: order.updatedAt || "-" },
    { key: "shop", label: "门店地址", children: order.shop.address || "-" },
    { key: "shopPhone", label: "门店电话", children: order.shop.phone || "-" },
    { key: "platform", label: "平台工单号", children: order.platformOrderNo || "-" },
    { key: "plate", label: "车牌号码", children: order.vehicle.plate || "-" },
    { key: "vin", label: "VIN/底盘号", children: order.vehicle.vin || "-" },
    { key: "mileage", label: "进厂里程", children: order.vehicle.mileage ? `${order.vehicle.mileage} km` : "-" },
    { key: "model", label: "车型", children: order.vehicle.model || "-" },
    { key: "purchase", label: "购车日期", children: order.vehicle.purchaseDate || "-" },
    { key: "customer", label: "车主名称/所属单位", children: order.customer.name || "-" },
    { key: "contact", label: "联系人", children: order.customer.contact || "-" },
    { key: "phone", label: "联系电话", children: order.customer.phone || "-" },
    { key: "address", label: "车辆地址", children: order.customer.address || "-", span: isMobile ? 2 : 3 },
    { key: "fault", label: "故障描述", children: order.faultDescription || "-", span: isMobile ? 2 : 3 },
    { key: "belongings", label: "随车物品", children: order.inspection.belongings.join("、") || "-" },
    { key: "exterior", label: "外观状况", children: order.inspection.exteriorIssues.join("、") || "-" },
    { key: "fuel", label: "燃油存量", children: order.inspection.fuelLevel },
    { key: "estimated", label: "预计修理费", children: `¥${order.estimatedFee || 0}` },
    { key: "settlement", label: "结算金额", children: `¥${order.settlementAmount || 0}` },
    { key: "oldParts", label: "旧件处置", children: order.oldPartsHandling },
    { key: "feeNote", label: "费用备注", children: order.feeNote || "-", span: isMobile ? 2 : 3 },
    { key: "signatures", label: "签字记录", children: signatures, span: isMobile ? 2 : 3 }
  ];

  return (
    <>
      <div className="workbench-order-summary">
        <span className="workbench-order-icon"><CarFront size={28} /></span>
        <div><span className="workbench-detail-eyebrow">车辆档案</span><h2>{order.vehicle.plate || '未登记车牌'}</h2><p>{order.vehicle.model || '车型待补充'}</p></div>
        <div className="workbench-order-status"><StatusChip status={workOrderDisplayStatus(order)} /><OrderLegacySyncStatus order={order} /></div>
      </div>
      {[
        { title: '委托与进度', icon: ClipboardList, keys: ['dispatch','advisor','arrival','delivery','updated','shop','shopPhone','id','platform'] },
        { title: '车辆与客户', icon: Users, keys: ['vin','mileage','purchase','customer','contact','phone','address'] },
        { title: '故障与检查', icon: CarFront, keys: ['fault','belongings','exterior','fuel'] },
        { title: '费用与签字', icon: Wallet, keys: ['estimated','settlement','oldParts','feeNote','signatures'] }
      ].map(group => <section className="workbench-detail-group" key={group.title}>
        <h3><group.icon size={18} />{group.title}</h3>
        <Descriptions className="archive-descriptions" layout="vertical" size="small" column={isMobile ? 2 : 3} items={group.keys.flatMap(key => descriptions.filter(item => item.key === key))} />
      </section>)}
      <OrderRepairRecords order={order} isMobile={isMobile}/>
      <SubmittedOrderPhotos order={order} user={user} onUpdated={onUpdated}/>
      <CustomerSignatureSection order={order} user={user} onUpdated={onUpdated}/>
      {isMobile ? <MobileOrderRecords order={order} /> : <DesktopOrderRecords order={order} />}
    </>
  );
}

export function OrderLegacySyncStatus({ order }: { order: WorkOrder }) {
  if (order.status === "草稿") return null;
  return <><LegacySyncStatusChip status={order.legacySyncStatus} /><CustomerVehicleUpdateTag order={order} /></>;
}

function OrderRepairRecords({order,isMobile}:{order:WorkOrder;isMobile:boolean}) {
  if(isMobile) return <Collapse className="archive-mobile-collapse" defaultActiveKey={["repairs"]} items={[
    { key: "repairs", label: `维修项目（${order.repairItems.length}）`, children: <MobileRecords rows={order.repairItems.map((item) => [
      ["项目", item.name || "-"], ["工费", `¥${item.laborFee}`], ["主修人", item.owner], ["状态", item.status], ["开工", item.startAt || "-"], ["完工", item.finishAt || "-"], ["检查人", item.inspector]
    ])} /> }
  ]}/>;
  return <DetailTable title="维修项目" rowKey="id" dataSource={order.repairItems} columns={[
      { title: "项目", dataIndex: "name" }, { title: "工费", dataIndex: "laborFee", render: (value: number) => `¥${value}` },
      { title: "主修人", dataIndex: "owner" }, { title: "状态", dataIndex: "status" }, { title: "开工", dataIndex: "startAt" },
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
      { title: "状态", dataIndex: "status" }, { title: "物料项目数", render: (_: unknown, item: WorkOrder["outboundOrders"][number]) => item.items.length }
    ]} />
    <OrderEventHistory order={order} kind="settlement" title="结算记录" />
    <OrderAuditHistory order={order} title="操作留痕" />
  </>;
}

function DetailTable<T extends object>({ title, rowKey, dataSource, columns }: {
  title: string; rowKey: string | ((item: T) => string); dataSource: T[]; columns: Parameters<typeof Table<T>>[0]["columns"];
}) {
  return <section className="archive-detail-section"><h3>{title}</h3><Table<T> size="small" rowKey={rowKey} dataSource={dataSource} columns={columns} pagination={false} scroll={{ x: "max-content" }} locale={{ emptyText: "暂无记录" }} /></section>;
}

function OrderAuditHistory({order,title}:{order:WorkOrder;title?:string}) {
  return <ActionHistory title={title} items={order.auditLog.map((item,index)=>({key:index,title:item.action,actor:item.actor,time:item.at}))}/>;
}

function OrderEventHistory({order,kind,title}:{order:WorkOrder;kind:'ocr'|'sync'|'settlement';title?:string}) {
  if(kind==='ocr')return <ActionHistory title={title} items={order.ocrRecords.map(item=>({key:item.id,title:`${item.source} · ${item.status}`,time:item.createdAt,detail:<><p>置信度：{item.confidence}</p><p>确认时间：{item.confirmedAt||'-'}</p></>}))}/>;
  if(kind==='sync')return <ActionHistory title={title} items={order.platformSyncRecords.map(item=>({key:item.id,title:`平台同步 · ${item.status}`,time:item.syncedAt,detail:<><p>平台工单号：{item.platformOrderNo}</p><p>{item.message}</p></>}))}/>;
  return <ActionHistory title={title} items={order.settlementStatements.map(item=>({key:item.id,title:`结算 · ¥${item.amount}`,time:item.syncedAt,detail:<><p>派工号：{item.dispatchNo}</p><p>来源：{item.source} · 匹配状态：{item.matchStatus}</p></>}))}/>;
}
