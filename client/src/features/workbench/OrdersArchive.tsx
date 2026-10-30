import { ListPagination } from '../../shared/ui/ListPagination';
import { OrderDetail, OrderLegacySyncStatus } from "./OrderDetail";

import { isUnsignedOrderEditable } from "../../../../shared/workOrderEditPolicy.mjs";
import { PendingRepairFollowups } from '../pending-repairs/PendingRepairFollowups';
import { ArchiveFilterBar } from "./ArchiveFilterBar";
import { archiveTimeLabel } from "./archiveFilters";
import { SignatureReview } from "../signature/SignatureReview";
import { PaperOrderResolution } from "../work-orders/components/PaperOrderResolution";
import { WorkOrderSignatureDialog } from "../signature/WorkOrderSignatureDialog";
import { CustomerVehicleEditor, CustomerVehicleUpdateNotice } from "../customer-vehicle-update/CustomerVehicleEditor";
import { useArchiveSignature } from "../signature/useArchiveSignature";
import { useArchiveLegacyRefresh } from "./useArchiveLegacyRefresh";
import { WorkOrderPrintButton } from "../work-order-print/WorkOrderPrintButton";
import {VehicleLicenseExceptionNotice} from '../work-orders/components/VehicleLicenseException';
import {isCurrentVehicleLicenseException} from '../work-orders/domain/vehicleLicenseException';
import { workOrderDisplayStatus } from "../work-orders/domain/workOrderDomain";
import { QuickDispatchDialog } from "../dispatch/QuickDispatchDialog";
import { dispatchEnabled } from "../dispatch/dispatchAvailability";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Empty, Grid, Input, Modal, Popconfirm, Spin, Table, Tag } from "antd";
import { ChevronRight, PencilLine, Trash2, RefreshCw } from "lucide-react";
import { WorkOrder } from "../../../../shared/types";
import { StatusChip } from "../../shared/ui/Status";
import { WorkbenchController } from "./useWorkbenchController";

const OrderOverviewDetail = lazy(() => import("../order-overview/OrderOverviewDetail").then(module => ({default: module.OrderOverviewDetail})));

export function OrdersArchive({ controller, overview = false }: { controller: WorkbenchController; overview?: boolean }) {
  const {
    searchTerm, setSearchTerm, searchedOrders, selectedId, selectOrder, setActiveNav,
    role, currentUser, deleteDraft, actionLoading, ordersLoading
  } = controller;
  const filterAnchor = useRef<HTMLDivElement>(null);
  const scrolledEntry = useRef<number | undefined>(undefined);
  const entryKey = overview && controller.todoEntry?.nav === '工单全览' ? controller.todoEntry.key : undefined;
  useEffect(() => {
    if (entryKey === undefined || ordersLoading || scrolledEntry.current === entryKey) return;
    const frame = requestAnimationFrame(() => {
      filterAnchor.current?.scrollIntoView({ block: 'start' });
      scrolledEntry.current = entryKey;
    });
    return () => cancelAnimationFrame(frame);
  }, [entryKey, ordersLoading]);
  const signature = useArchiveSignature(currentUser, controller.acceptRefreshedOrder, controller.refreshArchiveSummary);
  const [detailOrderId, setLocalDetailOrderId] = useState<string | undefined>(()=>new URLSearchParams(location.search).get("paperOrder") || undefined);
  const setDetailOrderId=(id?:string)=>{setLocalDetailOrderId(id);if(!id)controller.clearLinkedOrder();};
  const detailOrder = controller.orders.find(order => order.id === detailOrderId) || (controller.selectedOrder?.id === detailOrderId ? controller.selectedOrder : undefined) || ((!detailOrderId || controller.linkedOrderDetail?.id === detailOrderId) ? controller.linkedOrderDetail : undefined);
  const legacyRefresh = useArchiveLegacyRefresh(currentUser, controller.acceptRefreshedOrder, controller.refreshArchiveSummary);
  const listedOrders = searchedOrders.filter(order => !overview || order.shop.id === currentUser?.shopId);
  const refreshReport = legacyRefresh.report ? <Alert style={{ marginBottom: 12 }} showIcon
    type={legacyRefresh.report.failures.length ? "warning" : "success"}
    title={`润丰更新完成：成功 ${legacyRefresh.report.succeeded} 单，失败 ${legacyRefresh.report.failures.length} 单`}
    description={legacyRefresh.report.failures.length ? <ul style={{ paddingLeft: 18, marginBottom: 0 }}>{legacyRefresh.report.failures.map(failure =>
      <li key={failure.id}>{failure.id}：{failure.message}</li>)}</ul> : "已更新本地数据库，可查看最新详情或打印。"} /> : null;
  const [dispatchOrder, setDispatchOrder] = useState<WorkOrder>();
  const canAssign = (order: WorkOrder) => dispatchEnabled && ["advisor","manager"].includes(role) && order.shop.id===currentUser?.shopId && workOrderDisplayStatus(order) === "待派工" && (!order.technician || order.technician === "待派工");
  const canOpenDispatch = Boolean(detailOrder && dispatchEnabled && ["advisor","manager"].includes(role)
    && detailOrder.shop.id === currentUser?.shopId && !["草稿","待客户签字","待处理纸质委托书"].includes(detailOrder.status));
  const [deleteError, setDeleteError] = useState("");
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  function openDetail(order: WorkOrder) {
    selectOrder(order);
    setDeleteError("");
    legacyRefresh.clearReport();
    signature.clearError();
    setDetailOrderId(order.id);
  }

  function resumeDraft(order: WorkOrder) {
    selectOrder(order);
    setDetailOrderId(undefined);
    setActiveNav("委托开单");
  }

  const canManageDraft = Boolean(
    detailOrder?.status === "草稿" && detailOrder.shop.id === currentUser?.shopId
    && (role === "manager" || detailOrder.advisor === currentUser?.name)
  );

  const canEditUnsigned = Boolean(detailOrder && isUnsignedOrderEditable(detailOrder)
    && detailOrder.shop.id === currentUser?.shopId
    && (role === "manager" || (role === "advisor" && detailOrder.advisor === currentUser?.name)));

  async function handleDeleteDraft(order: WorkOrder) {
    setDeleteError("");
    const error = await deleteDraft(order);
    if (error) {
      setDeleteError(error);
      return;
    }
    setDetailOrderId(undefined);
  }

  return (
    <Card className="panel lower-panel workbench-archive">
      <div className="panel-header archive-header">
        <div>
          <h2>{overview ? "工单全览" : "归档查询"}</h2>
          <p>{overview ? "查看本店全部工单资料、维修流程，按分类下载照片 Word。" : "点击任一委托单可查看完整归档内容。"}</p>
        </div>
        <div className="workbench-archive-actions">
        {["advisor","manager"].includes(role)&&<PendingRepairFollowups user={controller.currentUser||undefined}/>}
        <Button loading={ordersLoading} onClick={() => void controller.refreshWorkbench()}>刷新列表</Button>
        {["advisor", "manager"].includes(role) && <Button icon={<RefreshCw size={16}/>} loading={Boolean(legacyRefresh.progress)}
          disabled={Boolean(legacyRefresh.progress)} onClick={() => void legacyRefresh.refreshAll()}>
          {legacyRefresh.progress ? `正在更新 ${legacyRefresh.progress.done}/${legacyRefresh.progress.total}` : "全部从润丰更新"}
        </Button>}
        <Input.Search className="search-box" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="搜索车牌 / VIN / 工单号 / 派工号" allowClear />
        </div>
      </div>
      {["advisor", "manager"].includes(role) && <p className="workbench-archive-help">更新全部已同步且有权限的委托单，不受搜索和分页影响；保留签名、照片和维修进度。更新期间请保持页面打开。</p>}
      {refreshReport}
      <div ref={filterAnchor} className="archive-filter-anchor"><ArchiveFilterBar key={currentUser?.id} archive={controller.archive} isMobile={isMobile} /></div>

      {isMobile ? (
        <Spin spinning={ordersLoading} description="正在加载委托单…">
        <div className="archive-mobile-list" aria-busy={ordersLoading} style={ordersLoading ? { minHeight: 180 } : undefined}>
          {listedOrders.length ? listedOrders.map((order) => (
            <button className={order.id === selectedId ? "archive-order-card selected" : "archive-order-card"} type="button" key={order.id} onClick={() => openDetail(order)}>
              <div className="archive-order-card-main">
                <div className="archive-order-card-title">
                  <strong>{order.vehicle.plate || "未登记车牌"}</strong>
                  <span className="archive-order-statuses">
                    <StatusChip status={workOrderDisplayStatus(order)} />{order.legacyApproved && <Tag color="green">已审</Tag>}
                    <OrderLegacySyncStatus order={order} />
                    {order.isBaiyuanOrder && <Tag color="blue">百援</Tag>}{order.paperOrder && <Tag color="orange">纸质委托书</Tag>}
                  </span>
                </div>
                <span className="archive-order-owner">{order.customer.name || "未登记车主"}</span>
                <span className="archive-order-id"><span>派工单号</span><strong className={order.dispatchNo ? undefined : "unassigned"}>{order.dispatchNo || "暂无派工号"}</strong></span>
                <div className="archive-order-meta">
                  <span><b>服务顾问</b>{order.advisor || "-"}</span>
                  <span><b>创建时间</b>{archiveTimeLabel(order, "created")}</span>
                </div>
              </div>
              <ChevronRight size={18} />
            </button>
          )) : !ordersLoading && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无符合条件的委托单"><Button onClick={controller.archive.reset}>清空筛选</Button></Empty>}
        </div>
        </Spin>
      ) : (
        <Table
          className="orders-table"
          loading={{ spinning: ordersLoading, description: "正在加载委托单…" }}
          aria-busy={ordersLoading}
          size="small"
          rowKey="id"
          scroll={{ x: "max-content" }}
          pagination={false}
          locale={{ emptyText: ordersLoading ? <div style={{ minHeight: 140 }} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无符合条件的委托单"><Button onClick={controller.archive.reset}>清空筛选</Button></Empty> }}
          rowClassName={(order) => order.id === selectedId ? "selected" : ""}
          onRow={(order) => ({ onClick: () => openDetail(order), tabIndex: 0, 'aria-label': `查看委托单 ${order.vehicle.plate || order.id}`, onKeyDown: event => {
            if (event.target !== event.currentTarget) return;
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDetail(order); }
          } })}
          dataSource={listedOrders}
          columns={[
            { title: "派工号", render: (_, order) => order.dispatchNo || "暂无派工号", width: 160 },
            { title: "车牌", render: (_, order) => order.vehicle.plate || "-" },
            { title: "车主", render: (_, order) => order.customer.name || "-" },
            { title: "服务顾问", dataIndex: "advisor" },
            { title: "维修技师", dataIndex: "technician" },
            { title: "业务状态", render: (_, order) => <><StatusChip status={workOrderDisplayStatus(order)} />{order.legacyApproved && <Tag color="green">已审</Tag>}{order.isBaiyuanOrder && <Tag color="blue">百援</Tag>}{order.paperOrder && <Tag color="orange">纸质委托书</Tag>}</> },
            { title: "润丰同步", render: (_, order) => <OrderLegacySyncStatus order={order} /> },
            { title: "金额", render: (_, order) => order.settlementAmount || order.estimatedFee ? `¥${order.settlementAmount || order.estimatedFee}` : "-" },
            { title: "创建时间", render: (_, order) => archiveTimeLabel(order, "created"), width: 145 },
            { title: "更新时间", render: (_, order) => archiveTimeLabel(order, "updated"), width: 145 }
          ]}
        />
      )}

      <ListPagination mobile={isMobile} page={controller.archive.page} total={controller.archive.total} loaded={listedOrders.length} loading={ordersLoading} onPage={controller.archive.setPage} onMore={controller.archive.loadMore}/>

      <Modal
        rootClassName="archive-detail-modal"
        open={Boolean(detailOrder)}
        title="委托单详情"
        width={isMobile ? "calc(100vw - 16px)" : 1080}
        style={isMobile ? { top: 8, paddingBottom: 8 } : undefined}
        onCancel={() => setDetailOrderId(undefined)}
        footer={overview ? <Button onClick={() => setDetailOrderId(undefined)}>关闭</Button> : (
          <div className="archive-detail-actions">
            {detailOrder && !detailOrder.paperOrder && ["草稿","待客户签字"].includes(detailOrder.status) && signature.canSign(detailOrder) && <Button type="primary" loading={signature.starting}
              onClick={() => void signature.start(detailOrder)}>{detailOrder.status === "草稿" ? "发起签字" : "继续签字"}</Button>}
            {detailOrder && legacyRefresh.canRefresh(detailOrder) && <Button icon={<RefreshCw size={16}/>} loading={Boolean(legacyRefresh.progress)}
              disabled={Boolean(legacyRefresh.progress)} onClick={() => void legacyRefresh.refresh([detailOrder])}>从润丰更新</Button>}
            {detailOrder && <WorkOrderPrintButton order={detailOrder} />}

            {canManageDraft && detailOrder ? (
              <Popconfirm
                title="确认删除这张草稿？"
                description="草稿及其照片、OCR 和操作记录将从系统中删除，无法恢复。"
                okText="确认删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => handleDeleteDraft(detailOrder)}
              >
                <Button danger icon={<Trash2 size={16} />} loading={actionLoading === "delete"}>删除草稿</Button>
              </Popconfirm>
            ) : null}
            {canEditUnsigned && detailOrder ? (
              <Button type="primary" icon={<PencilLine size={16} />} onClick={() => resumeDraft(detailOrder)}>{detailOrder.status === "草稿" ? "继续编辑草稿" : "编辑委托单"}</Button>
            ) : null}
            {detailOrder && canAssign(detailOrder) && <Button type="primary" onClick={() => { setDispatchOrder(detailOrder); setDetailOrderId(undefined); }}>派工</Button>}
            {canOpenDispatch && detailOrder && <Button onClick={() => {
              const orderId = detailOrder.id;
              setDetailOrderId(undefined);
              controller.openDispatch(orderId);
            }}>查看派工单</Button>}
            <Button onClick={() => setDetailOrderId(undefined)}>关闭</Button>
          </div>
        )}
        styles={{ body: { overflowY: "auto" } }}
      >
        {overview && detailOrder ? <Suspense fallback={<Spin/>}><OrderOverviewDetail key={detailOrder.id} id={detailOrder.id}/></Suspense> : <>
        {detailOrder && <PaperOrderResolution key={`paper-${detailOrder.id}`} order={detailOrder} user={currentUser} onUpdated={controller.acceptRefreshedOrder} onEdit={resumeDraft}/>}
        {detailOrder && <div style={{ marginBottom: 12 }}><CustomerVehicleEditor key={`${detailOrder.id}-${currentUser?.id}`} order={detailOrder} user={currentUser}
          disabled={Boolean(legacyRefresh.progress)} onUpdated={order => { controller.acceptRefreshedOrder(order); controller.refreshArchiveSummary(); }} /></div>}
        {detailOrder && <CustomerVehicleUpdateNotice order={detailOrder} />}
        {refreshReport}
        {signature.error && <Alert type="error" showIcon title="发起签字失败" description={signature.error} style={{ marginBottom: 12 }} />}
        {deleteError ? <Alert type="error" showIcon title="删除草稿失败" description={deleteError} style={{ marginBottom: 12 }} /> : null}
        {detailOrder?.vehicleLicenseException?<div style={{marginBottom:16}}><VehicleLicenseExceptionNotice exception={detailOrder.vehicleLicenseException} current={isCurrentVehicleLicenseException(detailOrder.vehicleLicenseException,detailOrder.vehicle)}/></div>:null}
        {detailOrder && <SignatureReview order={detailOrder} user={currentUser} onUpdated={controller.acceptRefreshedOrder} />}
        {detailOrder ? <OrderDetail key={detailOrder.id} order={detailOrder} isMobile={isMobile} user={currentUser} onUpdated={controller.acceptRefreshedOrder}/> : null}
        </>}
      </Modal>
      {signature.session && <WorkOrderSignatureDialog key={signature.session.token} session={signature.session}
        completeSignature={signature.completeSignature} onOrderUpdated={controller.acceptRefreshedOrder} onClose={signature.close} />}
      {dispatchEnabled && dispatchOrder && currentUser && <QuickDispatchDialog key={dispatchOrder.id} orderId={dispatchOrder.id} user={currentUser} onClose={() => { setDispatchOrder(undefined); void controller.refreshWorkbench(); }} />}
    </Card>
  );
}
