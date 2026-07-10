import { Search } from "lucide-react";
import { StatusChip } from "../../shared/ui/Status";
import { WorkbenchController } from "./useWorkbenchController";

export function OrdersArchive({ controller }: { controller: WorkbenchController }) {
  const { searchTerm, setSearchTerm, searchedOrders, selectedId, selectOrder } = controller;

  return (
<section className="panel lower-panel">
          <div className="panel-header">
            <div>
              <h2>归档查询</h2>
              <p>当前为本系统主数据；维修业务平台接口后续仅做同步/查询。</p>
            </div>
            <div className="search-box">
              <Search size={16} />
              <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="搜索车牌 / VIN / 工单号" />
            </div>
          </div>

          <div className="orders-table">
            <div className="orders-row orders-head">
              <span>委托单号</span>
              <span>车牌</span>
              <span>车主</span>
              <span>服务顾问</span>
              <span>维修技师</span>
              <span>状态</span>
              <span>金额</span>
              <span>更新时间</span>
            </div>
            {searchedOrders.map((order) => (
              <button className={order.id === selectedId ? "orders-row selected" : "orders-row"} key={order.id} type="button" onClick={() => selectOrder(order)}>
                <strong>{order.id}</strong>
                <span>{order.vehicle.plate || "-"}</span>
                <span>{order.customer.name || "-"}</span>
                <span>{order.advisor}</span>
                <span>{order.technician}</span>
                <StatusChip status={order.status} />
                <span>{order.settlementAmount || order.estimatedFee ? `¥${order.settlementAmount || order.estimatedFee}` : "-"}</span>
                <span>{order.updatedAt}</span>
              </button>
            ))}
          </div>
        </section>
  );
}
