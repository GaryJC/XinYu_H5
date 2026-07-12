import { Card, Input, Table } from "antd";
import { StatusChip } from "../../shared/ui/Status";
import { WorkbenchController } from "./useWorkbenchController";

export function OrdersArchive({ controller }: { controller: WorkbenchController }) {
  const { searchTerm, setSearchTerm, searchedOrders, selectedId, selectOrder } = controller;

  return (
    <Card className="panel lower-panel">
          <div className="panel-header">
            <div>
              <h2>归档查询</h2>
              <p>当前为本系统主数据；维修业务平台接口后续仅做同步/查询。</p>
            </div>
            <Input.Search className="search-box" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="搜索车牌 / VIN / 工单号" allowClear />
          </div>
          <Table
            className="orders-table"
            size="small"
            rowKey="id"
            pagination={{ pageSize: 8, showSizeChanger: false }}
            rowClassName={(order) => order.id === selectedId ? "selected" : ""}
            onRow={(order) => ({ onClick: () => selectOrder(order) })}
            dataSource={searchedOrders}
            columns={[
              { title: "委托单号", dataIndex: "id", width: 160 },
              { title: "车牌", render: (_, order) => order.vehicle.plate || "-" },
              { title: "车主", render: (_, order) => order.customer.name || "-" },
              { title: "服务顾问", dataIndex: "advisor", responsive: ["md"] },
              { title: "维修技师", dataIndex: "technician", responsive: ["lg"] },
              { title: "状态", render: (_, order) => <StatusChip status={order.status} /> },
              { title: "金额", render: (_, order) => order.settlementAmount || order.estimatedFee ? `¥${order.settlementAmount || order.estimatedFee}` : "-" },
              { title: "更新时间", dataIndex: "updatedAt", width: 145, responsive: ["md"] }
            ]}
          />
        </Card>
  );
}
