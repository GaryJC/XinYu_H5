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
    { key: "address", label: "车辆地址", children: order.customer.address || "-", span: isMobile ? 1 : 3 },
    { key: "fault", label: "故障描述", children: order.faultDescription || "-", span: isMobile ? 1 : 3 },
    { key: "belongings", label: "随车物品", children: order.inspection.belongings.join("、") || "-" },
    { key: "exterior", label: "外观状况", children: order.inspection.exteriorIssues.join("、") || "-" },
    { key: "fuel", label: "燃油存量", children: order.inspection.fuelLevel },
    { key: "estimated", label: "预计修理费", children: `¥${order.estimatedFee || 0}` },
    { key: "settlement", label: "结算金额", children: `¥${order.settlementAmount || 0}` },
    { key: "oldParts", label: "旧件处置", children: order.oldPartsHandling },
    { key: "feeNote", label: "费用备注", children: order.feeNote || "-", span: isMobile ? 1 : 3 },
    { key: "signatures", label: "签字记录", children: signatures, span: isMobile ? 1 : 3 }
  ];

  return (
    <>
      <Descriptions className="archive-descriptions" bordered size="small" column={isMobile ? 1 : 3} items={descriptions} />
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

function MobileOrderRecords({ order }: { order: WorkOrder }) {
  return <Collapse className="archive-mobile-collapse" defaultActiveKey={["repairs"]} items={[
    { key: "repairs", label: `维修项目（${order.repairItems.length}）`, children: <MobileRecords rows={order.repairItems.map((item) => [
      ["项目", item.name || "-"], ["工费", `¥${item.laborFee}`], ["主修人", item.owner], ["状态", item.status], ["开工", item.startAt || "-"], ["完工", item.finishAt || "-"], ["检查人", item.inspector]
    ])} /> },
    { key: "ocr", label: `OCR 记录（${order.ocrRecords.length}）`, children: <MobileRecords rows={order.ocrRecords.map((item) => [["来源", item.source], ["状态", item.status], ["置信度", String(item.confidence)], ["创建时间", item.createdAt], ["确认时间", item.confirmedAt || "-"]])} /> },
    { key: "sync", label: `平台同步（${order.platformSyncRecords.length}）`, children: <MobileRecords rows={order.platformSyncRecords.map((item) => [["平台工单号", item.platformOrderNo], ["状态", item.status], ["说明", item.message], ["同步时间", item.syncedAt]])} /> },
    { key: "outbound", label: `出库单（${order.outboundOrders.length}）`, children: <MobileRecords rows={order.outboundOrders.map((item) => [["出库单号", item.id], ["派工号", item.dispatchNo], ["技师", item.technician], ["状态", item.status], ["物料项目数", String(item.items.length)]])} /> },
    { key: "settlement", label: `结算记录（${order.settlementStatements.length}）`, children: <MobileRecords rows={order.settlementStatements.map((item) => [["派工号", item.dispatchNo], ["金额", `¥${item.amount}`], ["来源", item.source], ["匹配状态", item.matchStatus], ["同步时间", item.syncedAt]])} /> },
    { key: "audit", label: `操作留痕（${order.auditLog.length}）`, children: <MobileRecords rows={order.auditLog.map((item) => [["时间", item.at], ["操作人", item.actor], ["操作", item.action]])} /> }
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
    <DetailTable title="维修项目" rowKey="id" dataSource={order.repairItems} columns={[
      { title: "项目", dataIndex: "name" }, { title: "工费", dataIndex: "laborFee", render: (value: number) => `¥${value}` },
      { title: "主修人", dataIndex: "owner" }, { title: "状态", dataIndex: "status" }, { title: "开工", dataIndex: "startAt" },
      { title: "完工", dataIndex: "finishAt" }, { title: "检查人", dataIndex: "inspector" }
    ]} />
    <DetailTable title="OCR 记录" rowKey="id" dataSource={order.ocrRecords} columns={[
      { title: "来源", dataIndex: "source" }, { title: "状态", dataIndex: "status" }, { title: "置信度", dataIndex: "confidence" },
      { title: "创建时间", dataIndex: "createdAt" }, { title: "确认时间", dataIndex: "confirmedAt" }
    ]} />
    <DetailTable title="平台同步记录" rowKey="id" dataSource={order.platformSyncRecords} columns={[
      { title: "平台工单号", dataIndex: "platformOrderNo" }, { title: "状态", dataIndex: "status" }, { title: "说明", dataIndex: "message" }, { title: "同步时间", dataIndex: "syncedAt" }
    ]} />
    <DetailTable title="出库单" rowKey="id" dataSource={order.outboundOrders} columns={[
      { title: "出库单号", dataIndex: "id" }, { title: "派工号", dataIndex: "dispatchNo" }, { title: "技师", dataIndex: "technician" },
      { title: "状态", dataIndex: "status" }, { title: "物料项目数", render: (_: unknown, item: WorkOrder["outboundOrders"][number]) => item.items.length }
    ]} />
    <DetailTable title="结算记录" rowKey="id" dataSource={order.settlementStatements} columns={[
      { title: "派工号", dataIndex: "dispatchNo" }, { title: "金额", dataIndex: "amount", render: (value: number) => `¥${value}` },
      { title: "来源", dataIndex: "source" }, { title: "匹配状态", dataIndex: "matchStatus" }, { title: "同步时间", dataIndex: "syncedAt" }
    ]} />
    <DetailTable title="操作留痕" rowKey={(item) => `${item.at}-${item.actor}-${item.action}`} dataSource={order.auditLog} columns={[
      { title: "时间", dataIndex: "at" }, { title: "操作人", dataIndex: "actor" }, { title: "操作", dataIndex: "action" }
    ]} />
  </>;
}

function DetailTable<T extends object>({ title, rowKey, dataSource, columns }: {
  title: string; rowKey: string | ((item: T) => string); dataSource: T[]; columns: Parameters<typeof Table<T>>[0]["columns"];
}) {
  return <section className="archive-detail-section"><h3>{title}</h3><Table<T> size="small" rowKey={rowKey} dataSource={dataSource} columns={columns} pagination={false} scroll={{ x: "max-content" }} locale={{ emptyText: "暂无记录" }} /></section>;
}
