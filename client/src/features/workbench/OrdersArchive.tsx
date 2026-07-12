import { useState, type ReactNode } from "react";
import { Button, Card, Collapse, Descriptions, Empty, Grid, Image, Input, Modal, Table } from "antd";
import { ChevronRight } from "lucide-react";
import { WorkOrder } from "../../../../shared/types";
import { StatusChip } from "../../shared/ui/Status";
import { WorkbenchController } from "./useWorkbenchController";

export function OrdersArchive({ controller }: { controller: WorkbenchController }) {
  const { searchTerm, setSearchTerm, searchedOrders, selectedId, selectOrder } = controller;
  const [detailOrder, setDetailOrder] = useState<WorkOrder>();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  function openDetail(order: WorkOrder) {
    selectOrder(order);
    setDetailOrder(order);
  }

  return (
    <Card className="panel lower-panel">
      <div className="panel-header archive-header">
        <div>
          <h2>归档查询</h2>
          <p>点击任一委托单可查看完整归档内容。</p>
        </div>
        <Input.Search className="search-box" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="搜索车牌 / VIN / 工单号" allowClear />
      </div>

      {isMobile ? (
        <div className="archive-mobile-list">
          {searchedOrders.length ? searchedOrders.map((order) => (
            <button className={order.id === selectedId ? "archive-order-card selected" : "archive-order-card"} type="button" key={order.id} onClick={() => openDetail(order)}>
              <div className="archive-order-card-main">
                <div className="archive-order-card-title">
                  <strong>{order.vehicle.plate || "未登记车牌"}</strong>
                  <StatusChip status={order.status} />
                </div>
                <span className="archive-order-owner">{order.customer.name || "未登记车主"}</span>
                <span className="archive-order-id">{order.id}</span>
                <div className="archive-order-meta">
                  <span><b>服务顾问</b>{order.advisor || "-"}</span>
                  <span><b>金额</b>{order.settlementAmount || order.estimatedFee ? `¥${order.settlementAmount || order.estimatedFee}` : "-"}</span>
                  <span><b>更新时间</b>{order.updatedAt || "-"}</span>
                </div>
              </div>
              <ChevronRight size={18} />
            </button>
          )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无委托单" />}
        </div>
      ) : (
        <Table
          className="orders-table"
          size="small"
          rowKey="id"
          pagination={{ pageSize: 8, showSizeChanger: false }}
          rowClassName={(order) => order.id === selectedId ? "selected" : ""}
          onRow={(order) => ({ onClick: () => openDetail(order) })}
          dataSource={searchedOrders}
          columns={[
            { title: "委托单号", dataIndex: "id", width: 160 },
            { title: "车牌", render: (_, order) => order.vehicle.plate || "-" },
            { title: "车主", render: (_, order) => order.customer.name || "-" },
            { title: "服务顾问", dataIndex: "advisor" },
            { title: "维修技师", dataIndex: "technician" },
            { title: "状态", render: (_, order) => <StatusChip status={order.status} /> },
            { title: "金额", render: (_, order) => order.settlementAmount || order.estimatedFee ? `¥${order.settlementAmount || order.estimatedFee}` : "-" },
            { title: "更新时间", dataIndex: "updatedAt", width: 145 }
          ]}
        />
      )}

      <Modal
        rootClassName="archive-detail-modal"
        open={Boolean(detailOrder)}
        title={isMobile ? "委托单详情" : detailOrder ? `委托单详情 · ${detailOrder.id}` : "委托单详情"}
        width={isMobile ? "calc(100vw - 16px)" : 980}
        style={isMobile ? { top: 8, paddingBottom: 8 } : undefined}
        onCancel={() => setDetailOrder(undefined)}
        footer={<Button type="primary" block={isMobile} onClick={() => setDetailOrder(undefined)}>关闭</Button>}
        styles={{ body: { maxHeight: isMobile ? "calc(100vh - 132px)" : "72vh", overflowY: "auto" } }}
      >
        {detailOrder ? <OrderDetail order={detailOrder} isMobile={isMobile} /> : null}
      </Modal>
    </Card>
  );
}

function OrderDetail({ order, isMobile }: { order: WorkOrder; isMobile: boolean }) {
  const signatures = Object.entries(order.signatures).map(([type, name]) => `${type}: ${name}`).join("；") || "-";
  const vehicleLicenseFiles = (order.files ?? []).filter((file) => file.kind === "vehicle_license");
  const signatureFiles = (order.files ?? []).filter((file) => file.kind === "signature_image");
  const descriptions = [
    { key: "id", label: "委托单号", children: order.id },
    { key: "status", label: "状态", children: <StatusChip status={order.status} /> },
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
    { key: "customer", label: "车主名称", children: order.customer.name || "-" },
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
      <FileGallery title="行驶证照片" files={vehicleLicenseFiles} mobile={isMobile} />
      <FileGallery title="客户签名" files={signatureFiles} mobile={isMobile} />
      {isMobile ? <MobileOrderRecords order={order} /> : <DesktopOrderRecords order={order} />}
    </>
  );
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

function FileGallery({ title, files, mobile }: { title: string; files: NonNullable<WorkOrder["files"]>; mobile: boolean }) {
  return <section className="archive-detail-section">
    <h3>{title}</h3>
    {files.length ? <Image.PreviewGroup><div className="archive-file-gallery">{files.map((file) => (
      <div className="archive-file-card" key={file.id}>
        <Image width={mobile ? "100%" : 180} height={mobile ? 160 : 120} src={`/api/files/${encodeURIComponent(file.id)}/content`} alt={file.kind === "signature_image" ? "客户签名" : "行驶证照片"} />
        <span>{file.originalName || file.createdAt}</span>
      </div>
    ))}</div></Image.PreviewGroup> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无图片" />}
  </section>;
}

function DetailTable<T extends object>({ title, rowKey, dataSource, columns }: {
  title: string; rowKey: string | ((item: T) => string); dataSource: T[]; columns: Parameters<typeof Table<T>>[0]["columns"];
}) {
  return <section className="archive-detail-section"><h3>{title}</h3><Table<T> size="small" rowKey={rowKey} dataSource={dataSource} columns={columns} pagination={false} scroll={{ x: "max-content" }} locale={{ emptyText: "暂无记录" }} /></section>;
}
